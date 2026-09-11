import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import {insuranceDetails} from '../insurance-fields.js';
assert.equal(insuranceDetails({vehicleYear:2026}).vehicleYear,'2026');
assert.throws(()=>insuranceDetails({vehicleYear:'20.5'}));
assert.throws(()=>insuranceDetails({vehicleYear:'1800'}));
assert.equal(insuranceDetails(null).insuredPeople,'');
assert.equal(new URL(process.env.DATABASE_URL).hostname,process.env.TEST_DATABASE_HOST);
assert.equal(process.env.TEST_BRANCH_ID,'br-lucky-base-a6p21g5w');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const oldRows=(await db.query("select to_jsonb(p)-'details' data from insurance_policies p order by id")).rows.map(x=>x.data);
await db.query(await fs.readFile(new URL('../migrations/20260910_insurance_details.sql',import.meta.url),'utf8'));
assert.deepEqual((await db.query("select to_jsonb(p)-'details' data from insurance_policies p order by id")).rows.map(x=>x.data),oldRows);
const handler=(await import('../api/state.js')).default,sessions={},users=[],policies=[];
async function call(method,body={},role='Administrador'){
 const res={setHeader(){},status(n){this.statusCode=n;return this},json(data){this.body=JSON.parse(JSON.stringify(data));return this}};
 await handler({method,body,headers:{cookie:sessions[role]?'rentacontrol_session='+sessions[role]:''}},res);return res;
}
async function get(){const r=await call('GET');assert.equal(r.statusCode,200);return r.body}
let original,server;
async function cleanup(){
 for(const id of policies)await db.query('delete from insurance_policies where id=$1',[id]);
 if(original)assert.deepEqual((await get()).state,original);
 await db.query('delete from app_users where id=any($1::uuid[])',[users]);await db.end();
}
try{
 for(const role of ['Administrador','Cobranza','Consulta','Mantenimiento']){
  const id=crypto.randomUUID(),token=crypto.randomUUID();users.push(id);sessions[role]=token;
  await db.query('insert into app_users(id,name,email,role,active) values($1,$2,$3,$4,true)',[id,'Prueba seguros '+role,id+'@example.invalid',role]);
  await db.query("insert into app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '2 hours')",[id,crypto.createHash('sha256').update(token).digest('hex')]);
 }
 const start=await get();original=start.state;const state=structuredClone(original);
 for(const [i,type] of ['Coche','Inmueble','Gastos médicos','Vida'].entries()){
  const id=crypto.randomUUID();policies.push(id);state.insurance.push({id,type,company:'PRUEBA COBERTURA',policyNumber:'PRUEBA-'+i,validFrom:'2026-01-01',validTo:'2027-01-01',beneficiary:'Ana Prueba\nLuis Prueba',cost:123.45,reminderDays:[30,7],notes:'Prueba aislada',details:insuranceDetails({vehicleBrand:'Toyota',vehicleModel:'Corolla',vehicleYear:'2026',propertyAddress:'Calle de prueba 123\nCiudad de prueba',insuredPeople:'Persona de prueba 1\nPersona de prueba 2'})});
 }
 for(const role of ['Consulta','Mantenimiento'])assert.equal((await call('PUT',{state,revision:start.revision},role)).statusCode,403);
 let saved=await call('PUT',{state,revision:start.revision},'Cobranza');assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
 assert.deepEqual(saved.body.state.insurance.filter(x=>policies.includes(x.id)).sort((a,b)=>a.id.localeCompare(b.id)),state.insurance.filter(x=>policies.includes(x.id)).sort((a,b)=>a.id.localeCompare(b.id)));
 assert.equal((await call('PUT',{state,revision:start.revision})).statusCode,409);
 let cur=await get();assert.equal((await call('PUT',{state:cur.state,revision:cur.revision},'Mantenimiento')).statusCode,200);
 const legacy=structuredClone(cur.state);for(const p of legacy.insurance)delete p.details;
 saved=await call('PUT',{state:legacy,revision:cur.revision});assert.equal(saved.statusCode,200);assert.deepEqual(saved.body.state,cur.state);
 cur=await get();const bad=structuredClone(cur.state);bad.insurance.find(p=>p.id===policies[0]).details.vehicleYear='22';assert.equal((await call('PUT',{state:bad,revision:cur.revision})).statusCode,400);
 cur=await get();const edited=structuredClone(cur.state);edited.insurance.find(p=>p.id===policies[0]).details.vehicleYear='2027';saved=await call('PUT',{state:edited,revision:cur.revision});assert.equal(saved.statusCode,200);assert.equal((await get()).state.insurance.find(p=>p.id===policies[0]).details.vehicleYear,'2027');
 assert.equal((await db.query('select policy_type from insurance_policies where id=$1',[policies[2]])).rows[0].policy_type,'Gastos médicos');
 console.log('PASS migration preserves existing policies; create/edit/read four types; multiline people and beneficiaries; old clients preserve fields; roles, stale state and year validation');
 if(process.env.BROWSER_TEST==='1'){
  server=http.createServer(async(req,res)=>{try{
   const u=new URL(req.url,'http://localhost');const chunks=[];for await(const x of req)chunks.push(x);req.body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
   res.status=n=>{res.statusCode=n;return res};res.json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x))};req.headers.cookie='rentacontrol_session='+sessions.Administrador;
   if(u.pathname==='/api/state')return await handler(req,res);
   if(u.pathname==='/api/auth')return res.json({ok:true,user:{id:users[0],name:'Prueba seguros',role:'Administrador'}});
   if(u.pathname.includes('documents'))return res.json({ok:true,documents:[]});
   const name={'/':'index.html','/fiscal.js':'fiscal.js','/insurance-fields.js':'insurance-fields.js','/BAL%20INTRERNATIONAL.png':'BAL INTRERNATIONAL.png'}[u.pathname];
   if(name){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'image/png');return res.end(await fs.readFile(new URL('../'+name,import.meta.url)))}res.statusCode=404;res.end();
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('BROWSER READY http://127.0.0.1:'+server.address().port);
  await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);process.stdin.once('data',r)});server.close();
 }
 await cleanup();console.log('PASS all original data preserved; test records removed');process.exit(0);
}catch(e){console.error(e);await cleanup().catch(x=>console.error(x.message));process.exit(1)}
