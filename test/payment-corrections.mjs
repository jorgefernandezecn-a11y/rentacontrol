import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';
let source=await fs.readFile(new URL('../api/state.js',import.meta.url),'utf8');
for(const [name,path] of [['../insurance-fields.js','../insurance-fields.js'],['../fiscal.js','../fiscal.js'],['pg','../node_modules/pg/lib/index.js']])source=source.replace(`from "${name}"`,`from "${new URL(path,import.meta.url).href}"`);
source+='\nexport {correctPayment,pool,readState};';const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const id=crypto.randomUUID(),cid=crypto.randomUUID(),user={id:crypto.randomUUID(),role:'Administrador'},original={id,contract_id:cid,amount:'1000.00',period:'2026-09',payment_date:'2026-09-24'},payment={contractId:cid,amount:1200,period:'2026-10',date:'2026-09-24',method:'Efectivo',notes:'Corregido'},body={id,reason:'Importe capturado incorrectamente',payment};let calls=[];
const db={query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('select * from payments')?[original]:sql.startsWith('select id from contracts')?[{id:cid}]:[]}}};
for(const role of ['Consulta','Mantenimiento'])await assert.rejects(api.correctPayment(db,body,{...user,role},'PATCH'),e=>e.status===403);
assert.equal(calls.length,0);
for(const v of [{amount:0},{amount:-5},{amount:1.001},{amount:NaN},{period:'2026-13'},{date:'2026-02-30'},{contractId:'bad'}])await assert.rejects(api.correctPayment(db,{...body,payment:{...payment,...v}},user,'PATCH'),e=>e.status===400);
await assert.rejects(api.correctPayment(db,{...body,reason:''},user,'PATCH'),e=>e.status===400);
await assert.rejects(api.correctPayment(db,body,user,'DELETE'),e=>e.status===400);
assert(!calls.some(x=>x.sql.startsWith('insert')||x.sql.startsWith('update')||x.sql.startsWith('delete')));
calls=[];await api.correctPayment(db,body,user,'PATCH');assert(calls.find(x=>x.sql.startsWith('update payments')).args[0]===id);const audit=calls.find(x=>x.sql.startsWith('insert into audit_log'));assert.deepEqual(audit.args[3].before,original);assert.deepEqual(audit.args[3].after,payment);assert.equal(audit.args[1],'payment_edit');
calls=[];await api.correctPayment(db,{...body,confirmed:true},{...user,role:'Cobranza'},'DELETE');assert.deepEqual(calls.at(-1),{sql:'delete from payments where id=$1',args:[id]});assert.equal(calls.at(-2).args[1],'payment_delete');assert.equal(calls.at(-2).args[3].after,null);
await assert.rejects(api.correctPayment({query:async()=>({rows:[]})},body,user,'PATCH'),e=>e.status===404);
assert(source.includes("req.body?.revision!==revisionOf(before)"));
// Exercise the actual request handler including auth, revision, transaction and FK rollback.
process.env.DATABASE_URL='synthetic-test';
let rows=[structuredClone(original)],audits=[],snapshot,denyFk=false;
const transactionDb={release(){},query:async(sql,args)=>{
 if(sql==='begin'){snapshot={rows:structuredClone(rows),audits:structuredClone(audits)};return {rows:[]}}
 if(sql==='rollback'){rows=snapshot.rows;audits=snapshot.audits;return {rows:[]}}
 if(sql.includes('from app_sessions s join app_users'))return{rows:[{...user,active:true,session_id:'session'}]};
 if(sql==='select * from payments order by payment_date,created_at,id')return {rows};
 if(sql==='select * from payments where id=$1 for update')return{rows:rows.filter(x=>x.id===args[0])};
 if(sql==='select id from contracts where id=$1')return{rows:[{id:cid}]};
 if(sql.startsWith('insert into audit_log'))audits.push(args);
 if(sql==='delete from payments where id=$1'){if(denyFk)throw Object.assign(Error('related record'),{code:'23503'});rows=rows.filter(x=>x.id!==args[0]);}
 if(sql.startsWith('update payments set'))Object.assign(rows.find(x=>x.id===args[0]),{contract_id:args[1],period:args[2],amount:args[3],payment_date:args[4],method:args[5],notes:args[6]});
 return{rows:[]};
}};
api.pool.connect=async()=>transactionDb;
const invoke=async(method,body={},authenticated=true)=>{let code=200,result;await api.default({method,body,headers:{cookie:authenticated?'rentacontrol_session=synthetic':''}},{setHeader(){},status(v){code=v;return this},json(v){result=v}});return {code,result}};
assert.equal((await invoke('PATCH',body,false)).code,401);
let get=await invoke('GET');assert.equal(get.code,200);let revision=get.result.revision;
assert.equal((await invoke('PATCH',{...body,entity:'payment',revision:'stale'})).code,409);assert.equal(rows[0].amount,'1000.00');
let edited=await invoke('PATCH',{...body,entity:'payment',revision});assert.equal(edited.code,200);assert.equal(edited.result.state.payments[0].amount,1200);assert.equal(audits.length,1);
revision=edited.result.revision;denyFk=true;let deletion=await invoke('DELETE',{...body,entity:'payment',revision,confirmed:true});assert.equal(deletion.code,409);assert.equal(rows.length,1);assert.equal(audits.length,1);
denyFk=false;deletion=await invoke('DELETE',{...body,entity:'payment',revision,confirmed:true});assert.equal(deletion.code,200);assert.equal(deletion.result.state.payments.length,0);assert.equal(audits.length,2);assert.equal((await invoke('GET')).result.state.payments.length,0);
console.log('PASS actual HTTP handler with query doubles: authentication, stale revision, edit, FK rollback including audit, delete and reload.');
await api.pool.end();console.log('PASS payment edit/delete: roles, validation, exact ID, original audit, confirmation, missing record; transactional revision guard retained. Query doubles, not live Neon.');
