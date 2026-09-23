// Isolated Neon branch only. Credentials belong in the process environment, never in source.
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
assert(process.env.TEST_DATABASE_HOST&&new URL(process.env.DATABASE_URL).hostname===process.env.TEST_DATABASE_HOST);
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
const handler=(await import('../api/state.js')).default;
const suffix=crypto.randomUUID(),ids={users:[],properties:[],tenants:[],contracts:[],maintenance_tasks:[],property_documents:[],payments:[],credits:[]},sessions={};
async function insert(table,data){const id=crypto.randomUUID();ids[table].push(id);const keys=['id',...Object.keys(data)];await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,[id,...Object.values(data)]);return id}
async function call(method,body={},role='Administrador'){
 const response={setHeader(){},status(code){this.statusCode=code;return this},json(data){this.body=JSON.parse(JSON.stringify(data));return this}};
 await handler({method,headers:{cookie:sessions[role]?'rentacontrol_session='+sessions[role]:''},body},response);return response;
}
const snapshot=async()=>{const r=await call('GET');assert.equal(r.statusCode,200);return r.body};
const del=async(entity,id,role='Administrador')=>call('DELETE',{entity,id,revision:(await snapshot()).revision},role);
async function cleanup(){
 await db.query('delete from audit_log where user_id=any($1::uuid[])',[ids.users]);
 for(const table of ['property_documents','payments','credits','maintenance_tasks','contracts','tenants','properties'])await db.query(`delete from ${table} where id=any($1::uuid[])`,[ids[table]]);
 await db.query('delete from app_users where id=any($1::uuid[])',[ids.users]);await db.end();
}
async function user(role){const id=crypto.randomUUID();ids.users.push(id);const token=crypto.randomUUID();sessions[role]=token;await db.query('insert into app_users(id,name,email,role,active) values($1,$2,$3,$4,$5)',[id,'Test '+role,`${suffix}-${role}@example.invalid`,role==='Inactive'?'Administrador':role,role!=='Inactive']);await db.query("insert into app_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')",[id,crypto.createHash('sha256').update(token).digest('hex')]);}
async function fixture(name){
 const p=await insert('properties',{name:name+' inmueble',rent:500,deposit:500,status:'Rentada'});
 const t=await insert('tenants',{name:name+' inquilino',security_deposit:500});
 const c=await insert('contracts',{property_id:p,tenant_id:t,start_date:'2026-01-01',end_date:'2027-12-31',rent:500,status:'Vigente'});
 await insert('payments',{contract_id:c,period:'2026-09',amount:200,payment_date:'2026-09-09'});
 await insert('credits',{contract_id:c,amount:50,payment_date:'2026-09-09'});
 await insert('maintenance_tasks',{title:name+' mantenimiento',status:'Pendiente',property_id:p,tenant_id:t});
 const key=crypto.randomUUID();await insert('property_documents',{property_id:p,display_name:'Prueba documento',original_name:'test.pdf',mime_type:'application/pdf',size_bytes:1,blob_url:`https://example.invalid/${key}`,blob_pathname:key});return {p,t,c};
}
let server;
try{
 for(const role of ['Administrador','Cobranza','Mantenimiento','Consulta','Inactive'])await user(role);
 const baseline=await snapshot();
 // Regression: a newly created UUID remains addressable after Neon synchronization.
 const propertyId=crypto.randomUUID();ids.properties.push(propertyId);
 const draft={start:'2026-09-01',end:'2027-09-30',dueDay:5};
 const newProperty={id:propertyId,name:'PRUEBA INMUEBLE SIN DEPENDENCIAS',rent:10000,deposit:0,status:'Disponible',contractDraft:draft};
 let state=structuredClone(baseline.state);state.properties.push(newProperty);
 const savedProperty=await call('PUT',{state,revision:baseline.revision});assert.equal(savedProperty.statusCode,200,JSON.stringify(savedProperty.body));
 assert.deepEqual(savedProperty.body.state.properties.find(p=>p.id===propertyId).contractDraft,draft);
 assert.deepEqual((await snapshot()).state.properties.find(p=>p.id===propertyId).contractDraft,draft);
 let freshProperty=await snapshot();const legacy=structuredClone(freshProperty.state);delete legacy.properties.find(p=>p.id===propertyId).contractDraft;
 const preserved=await call('PUT',{state:legacy,revision:freshProperty.revision});assert.equal(preserved.statusCode,200,JSON.stringify(preserved.body));assert.deepEqual(preserved.body.state.properties.find(p=>p.id===propertyId).contractDraft,draft);
 const archivedProperty=await del('property',propertyId);assert.equal(archivedProperty.statusCode,200);assert(archivedProperty.body.state.properties.find(p=>p.id===propertyId).archivedAt);
 assert((await snapshot()).state.properties.find(p=>p.id===propertyId).archivedAt);
 const roundtrip=await call('PUT',{state:archivedProperty.body.state,revision:archivedProperty.body.revision});assert.equal(roundtrip.statusCode,200,JSON.stringify(roundtrip.body));
 console.log('PASS new property UUID, draft dates roundtrip, legacy-client preservation, archive without dependencies and post-archive synchronization');
 const f=await fixture('Prueba terminación');
 for(const role of ['Mantenimiento','Consulta','Inactive','Anonymous'])for(const entity of ['property','tenant','contract'])assert.equal((await del(entity,f[entity==='property'?'p':entity==='tenant'?'t':'c'],role)).statusCode,role==='Anonymous'?401:403);
 console.log('PASS authorization for all three entity types');
 const before=await snapshot();
 const deleted=await del('tenant',f.t);assert.equal(deleted.statusCode,200,JSON.stringify(deleted.body));
 const t=deleted.body.state.tenants.find(x=>x.id===f.t),c=deleted.body.state.contracts.find(x=>x.id===f.c),p=deleted.body.state.properties.find(x=>x.id===f.p);
 assert(t.archivedAt);assert.equal(t.securityDeposit,500);assert(c.archivedAt);assert.equal(c.status,'Terminado');assert.equal(c.end,'2027-12-31');assert.equal(c.terminationDate,new Date().toISOString().slice(0,10));assert.equal(p.status,'Disponible');assert(!p.archivedAt);
 for(const key of ['payments','credits','maintenance','insurance'])assert.deepEqual(deleted.body.state[key],before.state[key]);
 assert.equal((await db.query('select id from property_documents where property_id=$1',[f.p])).rowCount,1);
 assert.equal((await call('PUT',{state:before.state,revision:before.revision})).statusCode,409);
 const sync=await call('PUT',{state:deleted.body.state,revision:deleted.body.revision});assert.equal(sync.statusCode,200,JSON.stringify(sync.body));assert.deepEqual(sync.body.state,deleted.body.state);
 const revived=structuredClone(sync.body.state);revived.contracts.find(x=>x.id===f.c).status='Vigente';assert.equal((await call('PUT',{state:revived,revision:sync.body.revision})).statusCode,409);
 console.log('PASS active tenant deletion with deposit/payments/credits/maintenance/documents; contract closed, property released, history retained and synced');
 // A new occupancy after early termination must remain independent of the old record.
 const fresh=await snapshot(),newState=structuredClone(fresh.state);
 newState.tenants.push({id:'new-local-tenant',name:'Prueba nuevo inquilino'});
 newState.contracts.push({id:'new-local-contract',propertyId:f.p,tenantId:'new-local-tenant',start:'2026-09-09',end:'2027-09-09',rent:700,dueDay:5,status:'Vigente'});
 newState.properties.find(x=>x.id===f.p).status='Rentada';
 const created=await call('PUT',{state:newState,revision:fresh.revision});assert.equal(created.statusCode,200,JSON.stringify(created.body));
 const nextT=created.body.state.tenants.find(x=>x.name==='Prueba nuevo inquilino'),nextC=created.body.state.contracts.find(x=>x.tenantId===nextT.id);ids.tenants.push(nextT.id);ids.contracts.push(nextC.id);
 const repeat=await del('contract',f.c);assert.equal(repeat.statusCode,200);assert.equal(repeat.body.state.properties.find(x=>x.id===f.p).status,'Rentada');
 const contractDelete=await del('contract',nextC.id,'Cobranza');assert.equal(contractDelete.statusCode,200);assert(!contractDelete.body.state.tenants.find(x=>x.id===nextT.id).archivedAt);assert.equal(contractDelete.body.state.properties.find(x=>x.id===f.p).status,'Disponible');
 const propertyDelete=await del('property',f.p);assert.equal(propertyDelete.statusCode,200);assert(propertyDelete.body.state.properties.find(x=>x.id===f.p).archivedAt);
 console.log('PASS new occupancy, idempotent old-contract deletion, independent contract deletion, property deletion with historical documents');
 const raceFixture=await fixture('Prueba carrera'),raceSnapshot=await snapshot();
 const race=await Promise.all([1,2].map(()=>call('DELETE',{entity:'contract',id:raceFixture.c,revision:raceSnapshot.revision})));assert.deepEqual(race.map(x=>x.statusCode).sort(),[200,409]);
 console.log('PASS concurrent deletion serializes safely');
 if(process.env.BROWSER_TEST==='1'){
  await fixture('Prueba UI vigente');
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
 const sections={properties:'properties',tenants:'tenants',contracts:'contracts',payments:'payments',credits:'credits',maintenance:'maintenance_tasks'};
 for(const [section,table] of Object.entries(sections))finalState[section]=finalState[section].filter(x=>!ids[table].includes(x.id));
 assert.deepEqual(finalState,baseline.state,'Original records must remain unchanged');
 await cleanup();console.log('PASS original data unchanged, fixtures cleaned, production untouched');process.exit(0);
}catch(error){console.error(error);await cleanup().catch(e=>console.error('Cleanup failed',e.message));process.exit(1)}
