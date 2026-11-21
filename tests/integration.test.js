import { before,after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import pg from 'pg';
import { createApp } from '../server/app.js';
import { databaseConfig,setupDatabase } from '../scripts/database.mjs';
let pool,server,url;
before(async()=>{pool=new pg.Pool(databaseConfig('test'));server=createApp(pool).listen(0,'127.0.0.1');await once(server,'listening');url=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
beforeEach(async()=>{await setupDatabase('test',{reset:true});});
async function api(path,{person='owner',method='GET',payload,key,headers={}}={}){
 const response=await fetch(url+path,{method,headers:{'X-Demo-Person':person,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...headers},...(payload?{body:JSON.stringify(payload)}:{})});
 return {status:response.status,data:await response.json()};
}
const action=(id,name,options={})=>api(`/api/visits/${id}/actions/${name}`,{method:'POST',payload:{},...options});
test('fictional fixtures and tenant boundaries are enforced by the API',async()=>{
 const {data,status}=await api('/api/work');assert.equal(status,200);assert.equal(data.jobs.length,4);assert.equal(data.equipment.length,2);
 assert.ok(data.jobs.every(j=>j.business_id==='demo'));assert.ok(data.customers.every(c=>c.email.endsWith('@example.test')));
 assert.equal((await api('/api/work',{person:'other-owner'})).status,401);
 assert.equal((await action('other-visit','arrive')).status,404);
 assert.equal((await api('/api/work',{person:''})).status,401);
});
test('role and assigned-technician checks reject unauthorized actions',async()=>{
 assert.equal((await action('visit-1','arrive',{person:'tech-sam'})).status,403);
 const {data}=await api('/api/work');const v=data.visits.find(v=>v.id==='visit-1');
 const result=await action('visit-1','reschedule',{person:'tech-jordan',payload:{scheduled_start:v.scheduled_start,scheduled_end:v.scheduled_end,assigned_team_member_id:'tech-jordan'}});
 assert.equal(result.status,403);assert.equal((await action('visit-1','arrive',{person:'tech-jordan'})).status,200);
});
test('overlapping assignments roll back; adjacent visits and notifications work',async()=>{
 const {data}=await api('/api/work');const first=data.visits.find(v=>v.id==='visit-1');const second=data.visits.find(v=>v.id==='visit-2');
 const overlap=await action('visit-2','reschedule',{payload:{scheduled_start:first.scheduled_start,scheduled_end:first.scheduled_end,assigned_team_member_id:'tech-jordan'}});
 assert.equal(overlap.status,422);assert.equal(overlap.data.error,'TECH_SCHEDULE_CONFLICT');
 assert.equal((await api('/api/work')).data.visits.find(v=>v.id==='visit-2').assigned_team_member_id,'tech-sam');
 const adjacent=await action('visit-2','reschedule',{payload:{scheduled_start:first.scheduled_end,scheduled_end:second.scheduled_end,assigned_team_member_id:'tech-jordan'}});assert.equal(adjacent.status,200);
 const changed=(await api('/api/work')).data;assert.equal(changed.notifications.length,2);assert.ok(changed.events.some(e=>e.outcome==='rejected'));
});
test('concurrent competing assignments cannot double-book a technician',async()=>{
 const {data}=await api('/api/work');const d=new Date(data.visits[0].scheduled_start);d.setUTCHours(22,0,0,0);
 const payload={scheduled_start:d.toISOString(),scheduled_end:new Date(d.getTime()+3600000).toISOString(),assigned_team_member_id:'tech-sam'};
 const results=await Promise.all([action('visit-1','reschedule',{payload}),action('visit-4','reschedule',{payload})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,422]);
});
test('multi-visit jobs cannot complete early; completion survives an application reconnect',async()=>{
 const completeJob=()=>api('/api/jobs/job-4/actions/complete',{method:'POST',payload:{}});
 assert.equal((await completeJob()).data.error,'OPEN_VISITS_REMAIN');
 assert.equal((await action('visit-4','complete',{payload:{completion_notes:'too soon'}})).status,409);
 assert.equal((await action('visit-4','arrive')).status,200);
 assert.equal((await action('visit-4','complete')).data.error,'COMPLETION_NOTES_REQUIRED');
 assert.equal((await action('visit-4','complete',{payload:{completion_notes:'Fictional replacement installed and checked.'}})).status,200);
 assert.equal((await completeJob()).status,200);
 await new Promise(resolve=>server.close(resolve));await pool.end();
 pool=new pg.Pool(databaseConfig('test'));server=createApp(pool).listen(0,'127.0.0.1');await once(server,'listening');url=`http://127.0.0.1:${server.address().port}`;
 const {data}=await api('/api/work');assert.equal(data.jobs.find(j=>j.id==='job-4').status,'completed');assert.match(data.visits.find(v=>v.id==='visit-4').completion_notes,/Fictional replacement/);
});
test('concurrent retries with one idempotency key create only one event',async()=>{
 const [a,b]=await Promise.all([action('visit-1','en_route',{key:'retry-test'}),action('visit-1','en_route',{key:'retry-test'})]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.event_id,b.data.event_id);assert.equal((await api('/api/work')).data.events.length,1);
});
test('date validation, database status guards, and hostile web origins are rejected',async()=>{
 assert.equal((await action('visit-1','reschedule',{payload:{scheduled_start:'bad',scheduled_end:'bad'}})).status,400);
 assert.equal((await action('visit-1','arrive',{headers:{Origin:'https://example.test'}})).status,403);
 await assert.rejects(pool.query("UPDATE fsm.visits SET status='complete' WHERE id='visit-1'"),/Use the dispatcher/);
 const {data}=await api('/api/work');assert.equal(data.visits.find(v=>v.id==='visit-1').status,'scheduled');
});
