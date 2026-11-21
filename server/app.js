import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Dispatcher } from './core/dispatcher/dispatcher.js';
import { TransitionRegistry } from './core/dispatcher/registry.js';
import { registerVisitTransitions } from './core/transitions/visitTransitions.js';
import { registerJobTransitions } from './core/transitions/jobTransitions.js';
import { root } from '../scripts/database.mjs';
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export function createApp(pool) {
  const registry=new TransitionRegistry();registerVisitTransitions(registry);registerJobTransitions(registry);
  const dispatcher=new Dispatcher({pool,registry,id:randomUUID});
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const localHost=`127.0.0.1:${req.socket.localPort}`, alternate=`localhost:${req.socket.localPort}`;
    if (![localHost,alternate].includes(req.headers.host)) return res.status(403).json({error:'LOCAL_HOST_REQUIRED'});
    const origin=req.headers.origin;
    if(origin && ![`http://${localHost}`,`http://${alternate}`].includes(origin)) return res.status(403).json({error:'LOCAL_ORIGIN_REQUIRED'});
    res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');next();
  });
  app.use(express.json({limit:'16kb'}));
  app.get('/api/health',(_req,res)=>res.json({ok:true,mode:'fictional-local-demo'}));
  app.get('/api/people',asyncRoute(async(_req,res)=>{
    const {rows}=await pool.query("SELECT id,name,role FROM fsm.team_members WHERE business_id='demo' AND is_active ORDER BY role,name");res.json(rows);
  }));
  app.use('/api',asyncRoute(async(req,res,next)=>{
    // Demonstration identity selection is deliberately local, never production authentication.
    const person=req.get('X-Demo-Person');
    const {rows}=await pool.query("SELECT * FROM fsm.team_members WHERE business_id='demo' AND id=$1 AND is_active",[person || '']);
    if(!rows[0]) return res.status(401).json({error:'SELECT_DEMO_PERSON'});
    req.actor={kind:'user',business_id:rows[0].business_id,team_member_id:rows[0].id,role:rows[0].role};next();
  }));
  app.get('/api/work',asyncRoute(async(req,res)=>{
    const b=req.actor.business_id;
    const [jobs,visits,customers,equipment,events,outbox]=await Promise.all([
      pool.query(`SELECT j.*,c.display_name AS customer_name,p.address_line1,p.city FROM fsm.jobs j JOIN fsm.customers c ON c.id=j.customer_id AND c.business_id=j.business_id JOIN fsm.properties p ON p.id=j.property_id AND p.business_id=j.business_id WHERE j.business_id=$1 AND j.deleted_at IS NULL ORDER BY j.job_number`,[b]),
      pool.query(`SELECT v.*,t.name AS technician_name FROM fsm.visits v LEFT JOIN fsm.team_members t ON t.id=v.assigned_team_member_id AND t.business_id=v.business_id WHERE v.business_id=$1 ORDER BY v.scheduled_start,v.sequence_number`,[b]),
      pool.query('SELECT * FROM fsm.customers WHERE business_id=$1 ORDER BY display_name',[b]),
      pool.query('SELECT e.*,p.address_line1 FROM fsm.equipment e JOIN fsm.properties p ON p.id=e.property_id AND p.business_id=e.business_id WHERE e.business_id=$1 ORDER BY e.id',[b]),
      pool.query('SELECT * FROM fsm.event_log WHERE business_id=$1 ORDER BY occurred_at DESC,id LIMIT 50',[b]),
      pool.query('SELECT * FROM fsm.outbox WHERE business_id=$1 ORDER BY created_at DESC,id LIMIT 50',[b]),
    ]);
    res.set('Cache-Control','no-store');res.json({jobs:jobs.rows,visits:visits.rows,customers:customers.rows,equipment:equipment.rows,events:events.rows,notifications:outbox.rows});
  }));
  app.post('/api/:kind/:id/actions/:action',asyncRoute(async(req,res)=>{
    const allowed={visits:['reschedule','en_route','arrive','complete'],jobs:['complete']};
    if(!allowed[req.params.kind]?.includes(req.params.action)) return res.status(404).json({error:'UNKNOWN_ACTION'});
    const key=req.get('Idempotency-Key');
    if(key && key.length>200) return res.status(400).json({error:'INVALID_IDEMPOTENCY_KEY'});
    const result=await dispatcher.dispatch({entity_type:req.params.kind==='visits'?'visit':'job',entity_id:req.params.id,action:req.params.action,payload:req.body,actor:req.actor,http_idempotency_key:key});
    res.json(result);
  }));
  app.use('/api',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  app.use(express.static(join(root,'dist')));
  app.get('*',(_req,res)=>res.sendFile(join(root,'dist/index.html')));
  app.use((error,_req,res,_next)=>{
    const status=error.status || (error.code==='23P01'?422:500);
    res.status(status).json({error:error.code==='23P01'?'TECH_SCHEDULE_CONFLICT':status>=500?'LOCAL_SERVER_ERROR':error.code || 'INVALID_REQUEST',details:error.details || {}});
    if(status>=500) console.error(error);
  });
  return app;
}
