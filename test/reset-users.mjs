// Run only against an isolated Neon test branch, never production.
// DATABASE_URL=... TEST_DATABASE_HOST=... node test/reset-users.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const apiOnly=process.env.API_ONLY==='1';
const {chromium}=apiOnly?{}:await import(process.env.PLAYWRIGHT_MODULE||'playwright');
assert(process.env.TEST_DATABASE_HOST && new URL(process.env.DATABASE_URL).hostname===process.env.TEST_DATABASE_HOST,'Explicit test database hostname required');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const originalFetch=globalThis.fetch;
let emailUrl;
globalThis.fetch=async(url,options)=>{
  if(url==='https://api.resend.com/emails'){
    emailUrl=JSON.parse(options.body).html.match(/href="([^"]+)"/)[1];
    return new Response('{}',{status:200});
  }
  return originalFetch(url,options);
};
process.env.RESEND_API_KEY='test-intercepted-no-email-sent';
const reset=(await import('../api/reset-password.js')).default;
const users=(await import('../api/users.js')).default;
const auth=(await import('../api/auth.js')).default;
const state=(await import('../api/state.js')).default;
let confirms=0;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.status=code=>{res.statusCode=code;return res};res.json=data=>res.end(JSON.stringify(data));
  req.query=Object.fromEntries(url.searchParams);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  req.body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
  try{
    if(url.pathname==='/api/reset-password'){if(req.body.action==='confirm')confirms++;return await reset(req,res)}
    if(url.pathname==='/api/users')return await users(req,res);
    if(url.pathname==='/api/auth')return await auth(req,res);
    if(url.pathname==='/api/state')return await state(req,res);
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(await fs.readFile(new URL('../index.html',import.meta.url)))}
    res.statusCode=404;res.end();
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const api=async(path,body,cookie)=>{const r=await originalFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
const suffix=crypto.randomBytes(6).toString('hex');
const ids=[];
async function makeUser(role,active=true){const email=`test-${role}-${suffix}@example.invalid`;const q=await db.query('insert into app_users(name,email,role,active,password_hash) values($1,$2,$3,$4,$5) returning id',[`Prueba ${role}`,email,role,active,await bcrypt.hash('Old-password-123',12)]);ids.push(q.rows[0].id);return {id:q.rows[0].id,email}}
let browser;
try{
 const admin=await makeUser('Administrador');const subject=await makeUser('Consulta');
 const adminLogin=await api('/api/auth',{action:'login',email:admin.email,password:'Old-password-123'});assert.equal(adminLogin.status,200);
 const oldLogin=await api('/api/auth',{action:'login',email:subject.email,password:'Old-password-123'});assert.equal(oldLogin.status,200);
 assert.equal((await api('/api/reset-password',{action:'request',email:subject.email})).status,200);
 assert(emailUrl);const token=new URL(emailUrl).searchParams.get('reset');assert(token);
 const tokenRow=await db.query('select token_hash from password_reset_tokens where user_id=$1',[subject.id]);assert.equal(tokenRow.rows[0].token_hash,hash(token));
 let page;
 if(!apiOnly){
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 page=await browser.newPage();
 await page.goto(`${base}/?reset=${encodeURIComponent(token)}`);
 await page.locator('#authPassword').fill('New-password-456');
 // Reproduce original browser validation failure before verifying the fix.
 await page.locator('#authEmail').evaluate(el=>el.disabled=false);
 await page.locator('#authSubmit').click();assert.equal(confirms,0);
 await page.locator('#authEmail').evaluate(el=>el.disabled=true);
 await page.locator('#authSubmit').click();
 await page.getByText('Contraseña actualizada. Ya puedes iniciar sesión.').waitFor();assert.equal(confirms,1);
 }else{assert.equal((await api('/api/reset-password',{action:'confirm',token,password:'New-password-456'})).status,200)}
 assert.equal((await api('/api/auth',{action:'login',email:subject.email,password:'Old-password-123'})).status,401);
 assert.equal((await api('/api/auth',{action:'login',email:subject.email,password:'New-password-456'})).status,200);
 assert.equal((await api('/api/users',{action:'delete',id:admin.id},oldLogin.cookie)).status,401);
 assert.equal((await api('/api/reset-password',{action:'confirm',token,password:'Other-password-789'})).status,400);
 console.log('PASS: reset request/link -> confirm -> Neon -> new login; old password/session and token reuse rejected; API_ONLY='+apiOnly);
 for(const [tokenValue,expires] of [['expired-token',"now()-interval '1 minute'"],['race-token',"now()+interval '30 minutes'"]])await db.query(`insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,${expires})`,[subject.id,hash(tokenValue)]);
 assert.equal((await api('/api/reset-password',{action:'confirm',token:'expired-token',password:'Valid-password'})).status,400);
 assert.equal((await api('/api/reset-password',{action:'confirm',token:'unknown',password:'Valid-password'})).status,400);
 assert.equal((await api('/api/reset-password',{action:'confirm',token:'race-token',password:'short'})).status,400);
 const race=await Promise.all([1,2].map(i=>api('/api/reset-password',{action:'confirm',token:'race-token',password:`Concurrent-password-${i}`})));assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
 if(!apiOnly){await page.goto(`${base}/?reset=expired-token`);await page.locator('#authPassword').fill('Valid-password');await page.locator('#authSubmit').click();await page.getByText('El enlace es inválido o ya expiró.').waitFor();assert.equal(await page.locator('#authSubmit').isEnabled(),true);}
 console.log('PASS: expired/unknown/short-password errors and concurrent single use');
 assert.equal((await api('/api/users',{action:'delete',id:subject.id})).status,401);
 for(const role of ['Cobranza','Mantenimiento','Consulta']){
  const person=role==='Consulta'?subject:await makeUser(role);
  if(role==='Consulta')await db.query('update app_users set password_hash=$1 where id=$2',[await bcrypt.hash('Old-password-123',12),person.id]);
  const login=await api('/api/auth',{action:'login',email:person.email,password:'Old-password-123'});
  assert.equal((await api('/api/users',{action:'delete',id:admin.id},login.cookie)).status,403);
 }
 assert.equal((await api('/api/users',{action:'delete',id:admin.id},adminLogin.cookie)).status,400);
 assert.equal((await api('/api/users',{action:'delete',id:'bad-id'},adminLogin.cookie)).status,400);
 await db.query("insert into audit_log(user_id,action,entity_type,details) values($1,'test','test',$2)",[subject.id,{test:suffix}]);
 if(!apiOnly){await page.goto(base);await page.locator('#authEmail').fill(admin.email);await page.locator('#authPassword').fill('Old-password-123');await page.locator('#authSubmit').click();
 await page.locator('#authGate.hidden').waitFor({state:'attached'});
 await page.locator('#settingsBtn').click();await page.locator('#manageUsers').click();
 const button=page.locator(`[data-delete-user="${subject.id}"]`);await button.waitFor();
 await button.click();await page.locator('#cancelUserDeletion').click();assert.equal((await db.query('select id from app_users where id=$1',[subject.id])).rowCount,1);
 await button.click();await page.locator('#confirmUserDeletion').click();await button.waitFor({state:'detached'});
 }else{assert.equal((await api('/api/users',{action:'delete',id:subject.id},adminLogin.cookie)).status,200)}
 assert.equal((await db.query('select id from app_users where id=$1',[subject.id])).rowCount,0);
 assert.equal((await db.query('select id from app_sessions where user_id=$1',[subject.id])).rowCount,0);
 assert.equal((await db.query('select id from password_reset_tokens where user_id=$1',[subject.id])).rowCount,0);
 const audit=await db.query("select user_id,details from audit_log where details->>'test'=$1",[suffix]);assert.equal(audit.rows[0].user_id,null);assert.equal(audit.rows[0].details.deleted_user.id,subject.id);
 assert.equal((await api('/api/users',{action:'delete',id:subject.id},adminLogin.cookie)).status,404);
 console.log('PASS: admin deletion, denied for other roles/anonymous/self, sessions/tokens removed, audit history preserved; API_ONLY='+apiOnly);
}finally{
 await browser?.close();
 await db.query("delete from audit_log where details->>'test'=$1",[suffix]);
 await db.query('delete from app_users where id=any($1::uuid[])',[ids]);
 await db.end();server.close();
}
process.exit(0);
