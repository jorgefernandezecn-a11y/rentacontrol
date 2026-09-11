import http from 'node:http';
import fs from 'node:fs/promises';
const state={properties:[],tenants:[],contracts:[],payments:[],credits:[],maintenance:[],insurance:[],agenda:[]};
let stateFails=false,logoutFails=false,role='Administrador',calls=[],loginDelay=0;
const runner=String.raw`<!doctype html><meta charset="utf-8"><title>Pruebas de acceso</title><h1>Pruebas de acceso</h1><pre id="result">Ejecutando…</pre><iframe id="app" style="width:390px;height:844px"></iframe><script type="module">
const frame=document.querySelector('iframe'),out=document.querySelector('pre'),lines=[];
const wait=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout: '+fn)};
const check=(v,m)=>{if(!v)throw Error(m)};
const doc=()=>frame.contentDocument;
const status=()=>fetch('/test-status').then(r=>r.json());
const config=x=>fetch('/test-config',{method:'POST',body:JSON.stringify(x)});
const pass=m=>{lines.push('PASS '+m);out.textContent=lines.join('\n')};
const locked=()=>doc().body.classList.contains('access-locked');
const load=async()=>{frame.src='/?test='+Math.random();await new Promise(r=>frame.onload=r);await wait(()=>doc().querySelector('#authForm')?.onsubmit)};
const login=async()=>{doc().querySelector('#authEmail').value='test@example.invalid';doc().querySelector('#authPassword').value='Synthetic-password-123';doc().querySelector('#authForm').requestSubmit();await wait(()=>!doc().querySelector('#authSubmit').disabled)};
try{
await load();check(locked(),'inicio automático');await login();check(!locked(),'login válido');check((await status()).calls.join(',')==='logout,login','cookie restaurada');check(doc().querySelector('#authPassword').value==='','contraseña retenida');pass('Inicio exige credenciales y limpia contraseña');
await load();check(locked(),'recarga sin identificación');check(!(await status()).calls.includes('session'),'restauró sesión antigua');pass('Recarga exige identificarse aunque exista sesión anterior');
await login();Object.defineProperty(doc(),'visibilityState',{configurable:true,value:'hidden'});doc().dispatchEvent(new Event('visibilitychange'));check(locked(),'segundo plano sin bloqueo');check(frame.contentWindow.getComputedStyle(doc().querySelector('.app')).visibility==='hidden','datos visibles');pass('Segundo plano oculta datos de inmediato');
const loaded=new Promise(r=>frame.onload=r);Object.defineProperty(doc(),'visibilityState',{configurable:true,value:'visible'});doc().dispatchEvent(new Event('visibilitychange'));await loaded;await wait(()=>doc().querySelector('#authForm')?.onsubmit);check(locked(),'regreso sin login');pass('Regreso solicita credenciales');
await config({stateFails:true});await login();check(locked(),'fallo de nube reveló caché');check(doc().querySelector('#authMsg').textContent.includes('No se pudieron cargar'),'falta error nube');pass('Sin nube conserva pantalla de acceso');await config({stateFails:false,logoutFails:true});await load();await login();check(locked(),'revocación fallida permitió entrada');pass('Revocación fallida bloquea acceso');await config({logoutFails:false});await login();check(!locked(),'no recupera conexión');pass('Reintento recupera acceso');
await config({role:'Consulta'});await load();await login();check(!locked(),'Consulta no accede');check(doc().querySelector('#newProp').style.display==='none','Consulta puede editar');pass('Permisos Consulta conservados');
await config({role:'Mantenimiento'});await load();await login();check(doc().querySelector('#mantenimiento').classList.contains('active'),'vista mantenimiento');pass('Permisos Mantenimiento conservados');
await config({role:'Administrador'});await load();await login();const exited=new Promise(r=>frame.onload=r);doc().querySelector('#signOutBtn').click();await exited;await wait(()=>doc().querySelector('#authForm')?.onsubmit);check(locked(),'cerrar sesión sin bloqueo');pass('Cerrar sesión exige credenciales');
await load();Object.defineProperty(doc(),'visibilityState',{configurable:true,value:'hidden'});doc().dispatchEvent(new Event('visibilitychange'));Object.defineProperty(doc(),'visibilityState',{configurable:true,value:'visible'});doc().dispatchEvent(new Event('visibilitychange'));await login();check(!locked(),'autofill interrumpido');pass('Cambio de visibilidad en formulario no interrumpe autocompletado');
await load();await config({loginDelay:700});const entering=login();await wait(async()=>doc().querySelector('#authSubmit').disabled);Object.defineProperty(doc(),'visibilityState',{configurable:true,value:'hidden'});doc().dispatchEvent(new Event('visibilitychange'));await entering;check(locked(),'respuesta tardía abrió acceso');await config({loginDelay:0});pass('Respuesta tardía no desbloquea la app');
frame.src='/?reset=test-token';await new Promise(r=>frame.onload=r);await wait(()=>doc().querySelector('#authSubmit').textContent==='Guardar nueva contraseña');check(doc().querySelector('#authEmail').disabled,'correo bloquea recuperación');doc().querySelector('#authPassword').value='Synthetic-password-123';doc().querySelector('#authForm').requestSubmit();await wait(()=>doc().querySelector('#authMsg').textContent.includes('Contraseña actualizada'));pass('Recuperación de contraseña sigue funcionando');
await load();doc().querySelector('#rememberUser').checked=true;await login();await load();check(doc().querySelector('#authEmail').value==='test@example.invalid','no recuerda correo');check(doc().querySelector('#rememberUser').checked,'opción no persistida');check(doc().querySelector('#authPassword').value==='','guardó contraseña en formulario');check(locked(),'recordar usuario abrió sesión');pass('Recordar usuario conserva solo correo y exige contraseña');
doc().querySelector('#rememberUser').click();await load();check(doc().querySelector('#authEmail').value==='','no olvidó correo');check(!doc().querySelector('#rememberUser').checked,'opción sigue activa');check(!JSON.stringify({...frame.contentWindow.localStorage}).includes('Synthetic-password-123'),'contraseña almacenada localmente');pass('Desmarcar elimina correo; no se guarda contraseña local');
doc().querySelector('#iphonePasswordHelp').open=true;check(doc().querySelector('#iphonePasswordHelp').textContent.includes('rentacontrol-ruddy.vercel.app'),'falta sitio para Apple');pass('Ayuda de Contraseñas Apple disponible');
pass('TODAS LAS PRUEBAS COMPLETADAS');
}catch(e){out.textContent=lines.join('\n')+'\nFAIL '+e.message}
</script>`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const chunks=[];for await(const c of req)chunks.push(c);const data=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
 const send=(body,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
 if(url.pathname==='/test-status')return send({calls});
 if(url.pathname==='/test-config'){if('stateFails'in data)stateFails=data.stateFails;if('logoutFails'in data)logoutFails=data.logoutFails;if(data.role)role=data.role;if('loginDelay'in data)loginDelay=data.loginDelay;return send({ok:true})}
 if(url.pathname==='/test-runner'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(runner)}
 if(url.pathname==='/api/auth'){calls.push(data.action||'session');if(data.action==='logout')return send(logoutFails?{error:'Sin conexión'}:{ok:true},logoutFails?503:200);if(data.action==='login'&&loginDelay)await new Promise(r=>setTimeout(r,loginDelay));return send({ok:true,user:{id:'test-user',email:'test@example.invalid',role}})}
 if(url.pathname==='/api/state')return send(stateFails?{error:'Sin conexión'}:{state,revision:'test-revision',user:{id:'test-user',email:'test@example.invalid',role}},stateFails?503:200);
 if(url.pathname==='/api/reset-password')return send({ok:true});
 if(url.pathname.startsWith('/api/'))return send({users:[],documents:[]});
 const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
 if(!['index.html','fiscal.js','insurance-fields.js','BAL INTRERNATIONAL.png'].includes(name))return send({},404);
 res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'image/png'});res.end(await fs.readFile(new URL('../'+name,import.meta.url)));
});
server.listen(0,'127.0.0.1',()=>console.log('TEST URL http://127.0.0.1:'+server.address().port+'/test-runner'));
