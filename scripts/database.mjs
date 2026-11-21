import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export function databaseConfig(name = 'demo') {
  if (!['demo', 'test'].includes(name)) throw new Error('Unknown local database');
  return {host:join(root,'.local',name,'socket'),port:55439,user:'fsm_local',database:'field_service',options:'-c timezone=America/New_York'};
}
function run(command,args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  return execFileSync(command,args,{encoding:'utf8',env,stdio:['ignore','pipe','pipe']});
}
export function startDatabase(name = 'demo') {
  const dir=join(root,'.local',name), data=join(dir,'data'), config=databaseConfig(name);
  mkdirSync(config.host,{recursive:true,mode:0o700});
  if (!existsSync(join(data,'PG_VERSION'))) run('initdb',['-D',data,'-U','fsm_local','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
  let running=false;
  try {run('pg_ctl',['-D',data,'status']);running=true;} catch {}
  if (!running) run('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-k ${config.host} -p ${config.port} -c listen_addresses='' -c timezone=America/New_York`,'-w','start']);
  return config;
}
export function stopDatabase(name = 'demo') {
  const data=join(root,'.local',name,'data');
  if (!existsSync(join(data,'postmaster.pid'))) return;
  run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
}
export async function setupDatabase(name='demo', {reset=false}={}) {
  const config=startDatabase(name);
  const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
  try {if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='field_service'")).rowCount) await admin.query('CREATE DATABASE field_service');} finally {await admin.end();}
  const client=new pg.Client(config);await client.connect();
  try {
    await client.query('BEGIN');
    if (reset) {
      if (name !== 'test') throw new Error('Reset is only supported for the disposable test database');
      await client.query('DROP SCHEMA IF EXISTS fsm CASCADE');
    }
    if (!(await client.query("SELECT 1 FROM pg_namespace WHERE nspname='fsm'")).rowCount) {
      await client.query(readFileSync(join(root,'db/schema.sql'),'utf8'));
      await client.query(readFileSync(join(root,'db/seed.sql'),'utf8'));
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {await client.end();}
  return config;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const action=process.argv[2];
    if (action==='setup') await setupDatabase();
    else if(action==='start') startDatabase();
    else if(action==='stop') stopDatabase();
    else throw new Error('Usage: node scripts/database.mjs setup|start|stop');
    console.log(`Local demonstration database: ${action} complete.`);
  } catch(error) {console.error(error.message);if(error.stderr) console.error(String(error.stderr));process.exitCode=1;}
}
