// Integration tests: isolated Neon branch only. Supply credentials in process memory.
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
assert(process.env.TEST_DATABASE_HOST&&new URL(process.env.DATABASE_URL).hostname===process.env.TEST_DATABASE_HOST);
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
const handler=(await import('../api/state.js')).default;
const suffix=crypto.randomUUID(),ids={users:[],properties:[],tenants:[],contracts:[],maintenance_tasks:[],property_documents:[],insurance_policies:[],insurance_documents:[],payments:[],credits:[]};
const sessions={};
async function insert(table,data){const id=crypto.randomUUID();ids[table].push(id);const keys=['id',...Object.keys(data)];await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,[id,...Object.values(data)]);return id}
async function call(method,body={},role='Administrador'){
 const response={setHeader(){},status(code){this.statusCode=code;return this},json(data){this.body=data;return this}};
 await handler({method,headers:{cookie:sessions[role]?'rentacontrol_session='+sessions[role]:''},body},response);return response;
}
const snapshot=async()=>{const r=await call('GET');assert.equal(r.statusCode,200);return r.body};
const del=async(entity,id,role='Administrador')=>call('DELETE',{entity,id,revision:(await snapshot()).revision},role);
async function cleanup(){
 await db.query('delete from audit_log where user_id=any($1::uuid[])',[ids.users]);
 for(const table of ['insurance_documents','property_documents','payments','credits','maintenance_tasks','contracts','tenants','properties','insurance_policies'])await db.query(`delete from ${table} where id=any($1::uuid[])`,[ids[table]]);
 await db.query('delete from app_users where id=any($1::uuid[])',[ids.users]);await db.end();
}
let server;
// User ids use a separate fixture list.
async function user(role){const id=crypto.randomUUID();ids.users.push(id);const token=crypto.randomUUID();sessions[role]=token;await db.query('insert into app_users(id,name,email,role,active) values($1,$2,$3,$4,$5)',[id,'Test '+role,`${suffix}-${role}@example.invalid`,role==='Inactive'?'Administrador':role,role!=='Inactive']);await db.query("insert into app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[id,crypto.createHash('sha256').update(token).digest('hex')]);}
try{
 for(const role of ['Administrador','Cobranza','Mantenimiento','Consulta','Inactive'])await user(role);
 assert.equal((await call('GET',{},'Anonymous')).statusCode,401);
 const baseline=await snapshot();
 const freeP=await insert('properties',{name:'Prueba eliminar inmueble',rent:0,deposit:0});
 const freeT=await insert('tenants',{name:'Prueba eliminar inquilino'});
 for(const role of ['Mantenimiento','Consulta','Inactive','Anonymous']){
  const expected=role==='Inactive'?403:role==='Anonymous'?401:403;
  assert.equal((await del('property',freeP,role)).statusCode,expected);
  assert.equal((await del('tenant',freeT,role)).statusCode,expected);
 }
 const stale=await snapshot();
 assert.equal((await del('property',freeP)).statusCode,200);
 assert.equal((await del('tenant',freeT,'Cobranza')).statusCode,200);
 assert.equal((await del('property',freeP)).statusCode,404);
 assert.equal((await call('PUT',{state:stale.state,revision:stale.revision})).statusCode,409);
 assert.equal((await call('PUT',{state:stale.state})).statusCode,409);
 console.log('PASS deletion, permissions, missing record, stale and legacy clients rejected');
 const p=await insert('properties',{name:'Prueba historial',rent:500,deposit:500});
 const t=await insert('tenants',{name:'Prueba historial inquilino'});
 const contract=await insert('contracts',{property_id:p,tenant_id:t,start_date:'2026-01-01',end_date:'2026-12-31',rent:500,status:'Terminado'});
 await insert('payments',{contract_id:contract,period:'2026-09',amount:200,payment_date:'2026-09-09'});
 await insert('credits',{contract_id:contract,amount:50,payment_date:'2026-09-09'});
 for(const [entity,id] of [['property',p],['tenant',t]]){const r=await del(entity,id);assert.equal(r.statusCode,409);assert.match(r.body.error,/contratos/)}
 const mp=await insert('properties',{name:'Prueba mantenimiento'}),mt=await insert('tenants',{name:'Prueba mantenimiento inquilino'});
 await insert('maintenance_tasks',{title:'Prueba trabajo terminado',status:'Terminada',property_id:mp,tenant_id:mt});
 for(const [entity,id] of [['property',mp],['tenant',mt]]){const r=await del(entity,id);assert.equal(r.statusCode,409);assert.match(r.body.error,/mantenimiento/)}
 const dp=await insert('properties',{name:'Prueba expediente'});
 const doc=await insert('property_documents',{property_id:dp,display_name:'Prueba documento',original_name:'test.pdf',mime_type:'application/pdf',size_bytes:1,blob_url:`https://example.invalid/${suffix}`,blob_pathname:suffix});
 assert.match((await del('property',dp)).body.error,/documentos/);
 const dt=await insert('tenants',{name:'Prueba depósito',security_deposit:100});assert.match((await del('tenant',dt)).body.error,/depósito/);
 const policy=await insert('insurance_policies',{policy_type:'Inmueble',company:'Prueba',policy_number:suffix,valid_from:'2026-01-01',valid_to:'2026-12-31'});
 const insdoc=await insert('insurance_documents',{insurance_policy_id:policy,display_name:'Prueba póliza',original_name:'test.pdf',mime_type:'application/pdf',size_bytes:1,blob_url:`https://example.invalid/insurance-${suffix}`,blob_pathname:'insurance-'+suffix});
 console.log('PASS historical contracts/payments/credits, completed maintenance, property documents, deposits protected');
 const roundtrip=await snapshot();
 const put=await call('PUT',{state:roundtrip.state,revision:roundtrip.revision});assert.equal(put.statusCode,200,JSON.stringify(put.body));assert.deepEqual(put.body.state,roundtrip.state);
 for(const [table,id] of [['property_documents',doc],['insurance_documents',insdoc]])assert.equal((await db.query(`select id from ${table} where id=$1`,[id])).rowCount,1);
 const missing=structuredClone(put.body.state);missing.properties=missing.properties.filter(x=>x.id!==dp);
 assert.equal((await call('PUT',{state:missing,revision:put.body.revision})).statusCode,409);
 for(const section of ['contracts','payments','credits']){
  const stripped=structuredClone(put.body.state);stripped[section]=[];
  assert.equal((await call('PUT',{state:stripped,revision:put.body.revision})).statusCode,409);
 }
 assert.equal((await db.query("select id from audit_log where action='delete' and user_id=any($1::uuid[])",[ids.users])).rowCount,2);
 // Existing creation/edit flows preserve every collection and map local identifiers.
 const created=structuredClone(put.body.state);created.properties.push({id:'local-property',name:'Prueba creada por formulario',rent:100,deposit:0,status:'Disponible'});created.tenants.push({id:'local-tenant',name:'Prueba creada por formulario'});
 let saved=await call('PUT',{state:created,revision:put.body.revision});assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
 const np=saved.body.state.properties.find(x=>x.name==='Prueba creada por formulario'),nt=saved.body.state.tenants.find(x=>x.name==='Prueba creada por formulario');ids.properties.push(np.id);ids.tenants.push(nt.id);
 const raced=await Promise.all([1,2].map(()=>call('DELETE',{entity:'property',id:np.id,revision:saved.body.revision})));assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal((await del('tenant',nt.id)).statusCode,200);
 console.log('PASS sync roundtrip preserves dates/data/documents, create forms, and concurrent deletion');
 if(process.env.BROWSER_TEST==='1'){
  const bp=await insert('properties',{name:'Prueba UI inmueble'}),bt=await insert('tenants',{name:'Prueba UI inquilino'});
  server=http.createServer(async(req,res)=>{
   const url=new URL(req.url,'http://localhost');res.status=code=>{res.statusCode=code;return res};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))};
   req.query=Object.fromEntries(url.searchParams);const chunks=[];for await(const ch of req)chunks.push(ch);req.body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
   if(!req.headers.cookie)req.headers.cookie='rentacontrol_session='+sessions.Administrador;
   try{
    if(url.pathname==='/api/state')return await handler(req,res);
    if(url.pathname==='/api/auth')return res.json({ok:true,user:{id:ids.users[0],name:'Prueba Administrador',role:'Administrador'}});
    if(url.pathname==='/api/users')return res.json({ok:true,users:[{id:ids.users[0],name:'Prueba Administrador',role:'Administrador',active:true}]});
    if(url.pathname.includes('documents'))return res.json({ok:true,documents:[]});
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(await fs.readFile(new URL('../index.html',import.meta.url)))}
    res.statusCode=404;res.end();
   }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('BROWSER READY http://127.0.0.1:'+server.address().port);
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});server.close();
 }
 const finalState=(await snapshot()).state;
 const sections={properties:'properties',tenants:'tenants',contracts:'contracts',payments:'payments',credits:'credits',maintenance:'maintenance_tasks',insurance:'insurance_policies'};
 for(const [section,table] of Object.entries(sections))finalState[section]=finalState[section].filter(x=>!ids[table].includes(x.id));
 assert.deepEqual(finalState,baseline.state,'All original records must remain unchanged');
 await cleanup();console.log('PASS original records unchanged, fixture cleanup; production untouched');process.exit(0);
}catch(error){console.error(error);await cleanup().catch(e=>console.error('Cleanup failed',e.message));process.exit(1)}
