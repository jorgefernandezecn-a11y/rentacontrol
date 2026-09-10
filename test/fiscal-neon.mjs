import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import {draft} from './fiscal.mjs';
assert.equal(process.env.TEST_DATABASE_HOST,new URL(process.env.DATABASE_URL).hostname);
assert(process.env.TEST_DATABASE_HOST?.includes('ep-'));
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const baseline=(await db.query('select id,rent from contracts order by id')).rows;
await db.query(await fs.readFile(new URL('../migrations/20260910_contract_fiscal.sql',import.meta.url),'utf8'));
assert.deepEqual((await db.query('select id,rent from contracts order by id')).rows,baseline);
const handler=(await import('../api/state.js')).default,reports=(await import('../api/reports.js')).default;
const ids={users:[],contracts:[],properties:[],tenants:[],payments:[]},sessions={};
async function user(role){const id=crypto.randomUUID();ids.users.push(id);const token=crypto.randomUUID();sessions[role]=token;await db.query('insert into app_users(id,name,email,role,active) values($1,$2,$3,$4,true)',[id,'Prueba fiscal '+role,`${id}@example.invalid`,role]);await db.query("insert into app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '2 hours')",[id,crypto.createHash('sha256').update(token).digest('hex')]);}
async function call(method,body={},role='Administrador'){const res={setHeader(){},status(s){this.statusCode=s;return this},json(x){this.body=JSON.parse(JSON.stringify(x));return this}};await handler({method,body,headers:{cookie:sessions[role]?'rentacontrol_session='+sessions[role]:''}},res);return res}
const get=async()=>{const r=await call('GET');assert.equal(r.statusCode,200);return r.body};
let server,original;
async function cleanup(){await db.query('delete from audit_log where user_id=any($1::uuid[])',[ids.users]);for(const t of ['payments','contracts','tenants','properties'])await db.query(`delete from ${t} where id=any($1::uuid[])`,[ids[t]]);await db.query('delete from app_users where id=any($1::uuid[])',[ids.users]);if(original)assert.deepEqual((await get()).state,original);await db.end()}
try{
 for(const role of ['Administrador','Cobranza','Consulta','Mantenimiento'])await user(role);
 assert.equal((await call('GET',{},'Anonymous')).statusCode,401);original=(await get()).state;
 const pid=crypto.randomUUID(),tid=crypto.randomUUID(),cid=crypto.randomUUID();ids.properties.push(pid);ids.tenants.push(tid);ids.contracts.push(cid);
 await db.query("insert into properties(id,name,rent,status) values($1,'PRUEBA FISCAL',10000,'Rentada')",[pid]);await db.query("insert into tenants(id,name) values($1,'PRUEBA FISCAL INQUILINO')",[tid]);await db.query("insert into contracts(id,property_id,tenant_id,start_date,end_date,rent,status) values($1,$2,$3,'2026-01-01','2027-12-31',10000,'Vigente')",[cid,pid,tid]);
 const initial=await get(),changed=structuredClone(initial.state);changed.contracts.find(c=>c.id===cid).fiscal={legacyNet:10000,versions:[draft]};
 for(const role of ['Consulta','Mantenimiento'])assert.equal((await call('PUT',{state:changed,revision:initial.revision},role)).statusCode,403);
 let saved=await call('PUT',{state:changed,revision:initial.revision},'Cobranza');assert.equal(saved.statusCode,200,JSON.stringify(saved.body));assert.equal(saved.body.state.contracts.find(c=>c.id===cid).fiscal.versions[0].net,11600);
 assert.equal((await call('PUT',{state:changed,revision:initial.revision})).statusCode,409);
 let cur=await get();assert.equal((await call('PUT',{state:cur.state,revision:cur.revision})).statusCode,200);
 for(const mutation of [c=>delete c.fiscal,c=>c.rent=11600,c=>c.fiscal.versions[0].from='2026-08',c=>c.fiscal.versions[0].iva.value=-1]){cur=await get();const bad=structuredClone(cur.state);mutation(bad.contracts.find(c=>c.id===cid));assert.equal((await call('PUT',{state:bad,revision:cur.revision})).statusCode,400)}
 cur=await get();const tamper=structuredClone(cur.state);tamper.contracts.find(c=>c.id===cid).fiscal.versions[0].net=1;saved=await call('PUT',{state:tamper,revision:cur.revision});assert.equal(saved.statusCode,200);assert.equal(saved.body.state.contracts.find(c=>c.id===cid).fiscal.versions[0].net,11600);
 cur=await get();assert.equal((await call('PUT',{state:cur.state,revision:cur.revision},'Mantenimiento')).statusCode,200,'Unchanged fiscal state must not falsely deny maintenance');
 const pay=crypto.randomUUID();ids.payments.push(pay);await db.query("insert into payments(id,contract_id,period,amount,payment_date) values($1,$2,'2026-09',11600,'2026-09-10')",[pay,cid]);
 const raw=(await db.query('select rent,rent_fiscal from contracts where id=$1',[cid])).rows[0];assert.equal(Number(raw.rent),10000);assert.equal(raw.rent_fiscal.versions[0].net,11600);
 console.log('PASS Neon migration, original rents unchanged, persistence, roundtrip, permissions, stale client and history protections; server recomputes totals');
 if(process.env.BROWSER_TEST==='1'){
  server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');req.query=Object.fromEntries(u.searchParams);res.status=c=>{res.statusCode=c;return res};res.json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x))};res.send=x=>res.end(x);const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};req.headers.cookie='rentacontrol_session='+sessions.Administrador;
   try{if(u.pathname==='/api/state')return await handler(req,res);if(u.pathname==='/api/reports')return await reports(req,res);if(u.pathname==='/api/auth')return res.json({ok:true,user:{id:ids.users[0],name:'Prueba fiscal',role:'Administrador'}});if(u.pathname==='/api/users')return res.json({ok:true,users:[]});if(u.pathname.includes('documents'))return res.json({ok:true,documents:[]});const file={'/':'index.html','/fiscal.js':'fiscal.js','/BAL%20INTRERNATIONAL.png':'BAL INTRERNATIONAL.png'}[u.pathname];if(file){res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'image/png');return res.end(await fs.readFile(new URL('../'+file,import.meta.url)))}res.statusCode=404;res.end()}catch(e){res.statusCode=500;res.json({error:e.message})}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('BROWSER READY http://127.0.0.1:'+server.address().port);await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r)});server.close();
 }
 cur=await get();const closed=await call('DELETE',{entity:'contract',id:cid,revision:cur.revision});assert.equal(closed.statusCode,200);assert.equal((await call('PUT',{state:closed.body.state,revision:closed.body.revision})).statusCode,200,'Archived fiscal contracts must roundtrip unchanged');
 console.log('PASS fiscal history retained after archive and unrelated synchronization');
 // Compare before removing test sessions used by get().
 await db.query('delete from audit_log where user_id=any($1::uuid[])',[ids.users]);for(const t of ['payments','contracts','tenants','properties']){await db.query(`delete from ${t} where id=any($1::uuid[])`,[ids[t]]);ids[t]=[]}
 assert.deepEqual((await get()).state,original);original=null;await cleanup();console.log('PASS cleanup and original records preserved');process.exit(0);
}catch(e){console.error(e);original=null;await cleanup().catch(e=>console.error(e.message));process.exit(1)}
