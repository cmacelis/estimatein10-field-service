import pg from 'pg';
import { setupDatabase } from '../scripts/database.mjs';
import { createApp } from './app.js';
const pool=new pg.Pool(await setupDatabase());
const port=Number(process.env.FIELD_SERVICE_PORT || 4317);
const server=createApp(pool).listen(port,'127.0.0.1',()=>console.log(`Field Service is ready at http://127.0.0.1:${port} (fictional local data only)`));
server.on('error',async error=>{console.error(error.message);await pool.end();process.exitCode=1;});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
