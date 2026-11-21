import { spawnSync } from 'node:child_process';
import { setupDatabase, stopDatabase, root } from './database.mjs';
try {
 await setupDatabase('test',{reset:true});
 const result=spawnSync(process.execPath,['--test','tests/integration.test.js'],{cwd:root,stdio:'inherit'});
 if(result.error) throw result.error;
 process.exitCode=result.status??1;
} finally {stopDatabase('test');}
