import assert from 'node:assert/strict';
import pg from 'pg';
const adminId='11111111-1111-1111-1111-111111111111';
const targetId='22222222-2222-2222-2222-222222222222';
let actor;let writes=[];let sessionReads=0;let revoke=false;
pg.Pool.prototype.connect=async()=>({release(){},async query(sql){
 if(sql.includes('from app_sessions')){sessionReads++;return {rows:actor&&!(revoke&&sessionReads>1)?[actor]:[]}}
 writes.push(sql);
 if(sql.startsWith('select id,name,email'))return {rows:[{id:targetId,name:'Test',email:'test@example.invalid'}]};
 return {rows:[]};
}});
const handler=(await import('../api/users.js')).default;
async function call(user,id=targetId){actor=user;writes=[];sessionReads=0;const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}};await handler({method:'POST',headers:{cookie:'rentacontrol_session=fixture'},body:{action:'delete',id}},res);return res}
for(const role of ['Consulta','Cobranza','Mantenimiento']){assert.equal((await call({id:adminId,role,active:true})).code,403);assert.equal(writes.length,0)}
assert.equal((await call(null)).code,401);assert.equal(writes.length,0);
assert.equal((await call({id:adminId,role:'Administrador',active:false})).code,401);assert.equal(writes.length,0);
const admin={id:adminId,role:'Administrador',active:true};
assert.equal((await call(admin,adminId)).code,400);assert.equal(writes.length,0);
assert.equal((await call(admin)).code,200);assert(writes.includes('delete from app_users where id=$1'));
revoke=true;assert.equal((await call(admin)).code,403);assert(!writes.includes('delete from app_users where id=$1'));assert(writes.includes('rollback'));
console.log('PASS: only active admin may delete; other roles/anonymous/inactive/self denied; permission rechecked before deletion');
