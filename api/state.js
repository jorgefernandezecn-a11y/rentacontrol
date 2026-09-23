import { insuranceDetails } from "../insurance-fields.js";
import { normalizeFiscal, validateFiscalChange } from "../fiscal.js";
import pg from "pg";
import crypto from "crypto";
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:3,connectionTimeoutMillis:10000});
const COOKIE="rentacontrol_session",sha256=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||"");
const uid=v=>isUuid(v)?v:crypto.randomUUID(),num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d,today=()=>new Date().toISOString().slice(0,10),ym=()=>new Date().toISOString().slice(0,7);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""))&&!Number.isNaN(Date.parse(String(v)+"T12:00:00"));
function plusYear(d){const x=new Date(d+"T12:00:00");x.setFullYear(x.getFullYear()+1);return x.toISOString().slice(0,10)}
function dateOr(v,f){return validDate(v)?String(v).slice(0,10):f}
function parseCookies(req){const out={};for(const pair of String(req.headers.cookie||"").split(";")){const i=pair.indexOf("=");if(i>0)out[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim())}return out}
async function authorize(req,c){const token=parseCookies(req)[COOKIE];if(!token)return{ok:false,status:401,error:"Inicia sesiÃ³n para continuar."};const q=await c.query(`select u.id,u.name,u.email,u.role,u.active,s.id session_id from app_sessions s join app_users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() limit 1 for share of u,s`,[sha256(token)]);if(!q.rows.length)return{ok:false,status:401,error:"SesiÃ³n invÃ¡lida o expirada."};const u=q.rows[0];if(!u.active)return{ok:false,status:403,error:"Usuario desactivado."};await c.query("update app_sessions set last_seen_at=now() where id=$1",[u.session_id]);return{ok:true,user:{id:u.id,name:u.name,email:u.email,role:u.role}}}
function normalizePropertyDates(value){
  if(!value)return null;
  const {start='',end='',dueDay=5}=value;
  const realDate=d=>validDate(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
  if((start&&!realDate(start))||(end&&!realDate(end))||(start&&end&&end<start))throw fail(400,'Revisa las fechas previstas del inmueble.');
  return {start,end,dueDay:Math.min(31,Math.max(1,Math.trunc(num(dueDay,5))))};
}
const dateValue=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:String(v).slice(0,10);
async function readState(c){const[p,t,co,pay,cr,m,ins]=await Promise.all([c.query("select e.*,d.details contract_draft,a.created_at archived_at,a.details->>'terminationDate' termination_date from properties e left join lateral(select details from audit_log where action='property_dates' and entity_type='property' and entity_id=e.id::text order by id desc limit 1) d on true left join lateral(select created_at,details from audit_log where action='archive' and entity_type='property' and entity_id=e.id::text order by id desc limit 1) a on true order by e.created_at,e.id"),c.query("select e.*,a.created_at archived_at,a.details->>'terminationDate' termination_date from tenants e left join lateral(select created_at,details from audit_log where action='archive' and entity_type='tenant' and entity_id=e.id::text order by id desc limit 1) a on true order by e.created_at,e.id"),c.query("select e.*,a.created_at archived_at,a.details->>'terminationDate' termination_date from contracts e left join lateral(select created_at,details from audit_log where action='archive' and entity_type='contract' and entity_id=e.id::text order by id desc limit 1) a on true order by e.created_at,e.id"),c.query("select * from payments order by payment_date,created_at,id"),c.query("select * from credits order by payment_date,created_at,id"),c.query("select * from maintenance_tasks order by task_date nulls last,created_at,id"),c.query("select * from insurance_policies order by valid_to nulls last,created_at,id")]);return{properties:p.rows.map(x=>({id:x.id,archivedAt:x.archived_at||null,name:x.name,type:x.type,address:x.address,rent:num(x.rent),deposit:num(x.deposit),status:x.status,contractDraft:normalizePropertyDates(x.contract_draft)})),tenants:t.rows.map(x=>({id:x.id,archivedAt:x.archived_at||null,name:x.name,phone:x.phone||"",email:x.email||"",securityDeposit:x.security_deposit==null?null:num(x.security_deposit),guarantor:{name:x.guarantor_name||"",phones:x.guarantor_phones||"",email:x.guarantor_email||"",address:x.guarantor_address||"",propertyType:x.guarantor_property_type||"",propertyAddress:x.guarantor_property_address||""}})),contracts:co.rows.map(x=>({id:x.id,archivedAt:x.archived_at||null,terminationDate:x.termination_date||null,propertyId:x.property_id,tenantId:x.tenant_id,start:dateValue(x.start_date),end:dateValue(x.end_date),rent:num(x.rent),fiscal:normalizeFiscal(x.rent_fiscal),dueDay:num(x.due_day,5),status:x.status})),payments:pay.rows.map(x=>({id:x.id,contractId:x.contract_id,period:x.period,amount:num(x.amount),date:dateValue(x.payment_date),method:x.method||"",notes:x.notes||""})),credits:cr.rows.map(x=>({id:x.id,contractId:x.contract_id,amount:num(x.amount),date:dateValue(x.payment_date),note:x.note||""})),maintenance:m.rows.map(x=>({id:x.id,title:x.title,type:x.type||"Otro",status:x.status||"Pendiente",propertyId:x.property_id||"",tenantId:x.tenant_id||"",responsible:x.responsible||"",date:x.task_date?dateValue(x.task_date):"",notes:x.notes||""})),insurance:ins.rows.map(x=>({id:x.id,type:x.policy_type,company:x.company,policyNumber:x.policy_number,validFrom:x.valid_from?dateValue(x.valid_from):"",validTo:x.valid_to?dateValue(x.valid_to):"",beneficiary:x.beneficiary||"",details:insuranceDetails(x.details),cost:num(x.cost),reminderDays:Array.isArray(x.reminder_days)?x.reminder_days.map(Number):[30,15,7,1],notes:x.notes||""})),agenda:[]}}
const stable=x=>JSON.stringify(x||[]);
function permissionError(role,before,after){if(role==="Administrador"||role==="Cobranza")return null;const sections=["properties","tenants","contracts","payments","credits","maintenance","insurance"],allowed=role==="Mantenimiento"?new Set(["maintenance"]):new Set(),changed=sections.filter(k=>stable(before[k])!==stable(after[k]));if(changed.every(k=>allowed.has(k)))return null;if(role==="Consulta")return"Tu perfil es de solo consulta. No tienes permiso para modificar informaciÃ³n.";if(role==="Mantenimiento")return"Tu perfil de Mantenimiento puede modificar Ãºnicamente mantenimientos, fallas, notas, avances y estado de trabajos.";return"No tienes permiso para realizar esta modificaciÃ³n."}
function normalized(input){const s=input&&typeof input==="object"?input:{},properties=Array.isArray(s.properties)?s.properties:[],tenants=Array.isArray(s.tenants)?s.tenants:[],contracts=Array.isArray(s.contracts)?s.contracts:[],payments=Array.isArray(s.payments)?s.payments:[],credits=Array.isArray(s.credits)?s.credits:[],maintenance=Array.isArray(s.maintenance)?s.maintenance:[],insurance=Array.isArray(s.insurance)?s.insurance:[];for(const c of contracts){const fp=payments.filter(p=>p.contractId===c.id&&/^\d{4}-\d{2}$/.test(String(p.period||""))).map(p=>p.period).sort()[0],fs=fp?`${fp}-01`:today();c.start=dateOr(c.start,fs);c.end=dateOr(c.end,plusYear(c.start));c.dueDay=Math.min(31,Math.max(1,Math.trunc(num(c.dueDay,5))));c.rent=num(c.rent);c.fiscal=normalizeFiscal(c.fiscal);c.status=c.status||"Vigente"}for(const p of payments){p.period=/^\d{4}-\d{2}$/.test(String(p.period||""))?String(p.period):ym();p.date=dateOr(p.date,`${p.period}-01`);p.amount=num(p.amount)}for(const c of credits){c.date=dateOr(c.date,today());c.amount=num(c.amount)}for(const x of properties){x.name=String(x.name||"Inmueble").trim()||"Inmueble";x.rent=num(x.rent);x.deposit=num(x.deposit);x.contractDraft=normalizePropertyDates(x.contractDraft);x.status=x.status||"Disponible"}for(const x of tenants)x.name=String(x.name||"Inquilino").trim()||"Inquilino";for(const x of maintenance){x.title=String(x.title||"Mantenimiento").trim()||"Mantenimiento";x.date=x.date&&validDate(x.date)?x.date:"";x.status=x.status||"Pendiente"}for(const x of insurance){x.details=insuranceDetails(x.details);x.type=["Coche","Inmueble","Gastos médicos","Vida"].includes(x.type)?x.type:"Inmueble";x.company=String(x.company||"").trim();x.policyNumber=String(x.policyNumber||"").trim();x.validFrom=x.validFrom&&validDate(x.validFrom)?x.validFrom:"";x.validTo=x.validTo&&validDate(x.validTo)?x.validTo:"";x.beneficiary=String(x.beneficiary||"").trim();x.cost=num(x.cost);x.reminderDays=(Array.isArray(x.reminderDays)?x.reminderDays:[30,15,7,1]).map(Number).filter(n=>[30,15,7,1].includes(n));x.notes=String(x.notes||"")}return{properties,tenants,contracts,payments,credits,maintenance,insurance,agenda:[]}}
async function replaceState(c,input,user,before){const s=normalized(structuredClone(input));for(const k of ["payments","credits","maintenance","insurance"])for(const x of s[k])x.id=uid(x.id);const pm=new Map(),tm=new Map(),cm=new Map();for(const x of s.properties)pm.set(x.id,uid(x.id));for(const x of s.tenants)tm.set(x.id,uid(x.id));for(const x of s.contracts)cm.set(x.id,uid(x.id));for(const x of s.properties)await c.query(`insert into properties(id,name,type,address,rent,deposit,status) values($1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set name=excluded.name,type=excluded.type,address=excluded.address,rent=excluded.rent,deposit=excluded.deposit,status=excluded.status`,[pm.get(x.id),x.name,x.type||null,x.address||null,x.rent,x.deposit,x.status]);// Draft dates follow the existing audit-backed metadata pattern; no contract is fabricated.
for(const x of s.properties){
  const previous=before.properties.find(p=>p.id===x.id)?.contractDraft||null;
  if(JSON.stringify(previous)!==JSON.stringify(x.contractDraft||null))
    await c.query("insert into audit_log(user_id,action,entity_type,entity_id,details) values($1,'property_dates','property',$2,$3)",[user.id,pm.get(x.id),x.contractDraft]);
}
for(const x of s.tenants){const g=x.guarantor||{};await c.query(`insert into tenants(id,name,phone,email,security_deposit,guarantor_name,guarantor_phones,guarantor_email,guarantor_address,guarantor_property_type,guarantor_property_address) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do update set name=excluded.name,phone=excluded.phone,email=excluded.email,security_deposit=excluded.security_deposit,guarantor_name=excluded.guarantor_name,guarantor_phones=excluded.guarantor_phones,guarantor_email=excluded.guarantor_email,guarantor_address=excluded.guarantor_address,guarantor_property_type=excluded.guarantor_property_type,guarantor_property_address=excluded.guarantor_property_address`,[tm.get(x.id),x.name,x.phone||null,x.email||null,x.securityDeposit==null?null:num(x.securityDeposit),g.name||null,g.phones||null,g.email||null,g.address||null,g.propertyType||null,g.propertyAddress||null])}for(const x of s.contracts){const pid=pm.get(x.propertyId),tid=tm.get(x.tenantId);if(pid&&tid)await c.query(`insert into contracts(id,property_id,tenant_id,start_date,end_date,rent,due_day,status,rent_fiscal) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do update set property_id=excluded.property_id,tenant_id=excluded.tenant_id,start_date=excluded.start_date,end_date=excluded.end_date,rent=excluded.rent,due_day=excluded.due_day,status=excluded.status,rent_fiscal=excluded.rent_fiscal`,[cm.get(x.id),pid,tid,x.start,x.end,x.rent,x.dueDay,x.status,x.fiscal])}for(const x of s.payments){const cid=cm.get(x.contractId);if(cid)await c.query(`insert into payments(id,contract_id,period,amount,payment_date,method,notes) values($1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set contract_id=excluded.contract_id,period=excluded.period,amount=excluded.amount,payment_date=excluded.payment_date,method=excluded.method,notes=excluded.notes`,[uid(x.id),cid,x.period,x.amount,x.date,x.method||null,x.notes||null])}for(const x of s.credits){const cid=cm.get(x.contractId);if(cid)await c.query(`insert into credits(id,contract_id,amount,payment_date,note) values($1,$2,$3,$4,$5) on conflict (id) do update set contract_id=excluded.contract_id,amount=excluded.amount,payment_date=excluded.payment_date,note=excluded.note`,[uid(x.id),cid,x.amount,x.date,x.note||null])}for(const x of s.maintenance)await c.query(`insert into maintenance_tasks(id,title,type,status,property_id,tenant_id,responsible,task_date,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do update set title=excluded.title,type=excluded.type,status=excluded.status,property_id=excluded.property_id,tenant_id=excluded.tenant_id,responsible=excluded.responsible,task_date=excluded.task_date,notes=excluded.notes`,[uid(x.id),x.title,x.type||null,x.status,x.propertyId?pm.get(x.propertyId)||null:null,x.tenantId?tm.get(x.tenantId)||null:null,x.responsible||null,x.date||null,x.notes||null]);for(const x of s.insurance){if(!x.company||!x.policyNumber)continue;await c.query(`insert into insurance_policies(id,policy_type,company,policy_number,valid_from,valid_to,beneficiary,cost,reminder_days,notes,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do update set policy_type=excluded.policy_type,company=excluded.company,policy_number=excluded.policy_number,valid_from=excluded.valid_from,valid_to=excluded.valid_to,beneficiary=excluded.beneficiary,cost=excluded.cost,reminder_days=excluded.reminder_days,notes=excluded.notes,details=excluded.details`,[uid(x.id),x.type,x.company,x.policyNumber,x.validFrom||null,x.validTo||null,x.beneficiary||null,x.cost,x.reminderDays||[30,15,7,1],x.notes||null,x.details])}for(const [table,items] of [['payments',s.payments],['credits',s.credits],['maintenance_tasks',s.maintenance],['contracts',s.contracts],['insurance_policies',s.insurance]]){
await c.query(`delete from ${table} where not (id=any($1::uuid[]))`,[items.map(x=>table==='contracts'?cm.get(x.id):uid(x.id))]);
}}

const revisionOf=state=>sha256(JSON.stringify(state));
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function archiveRecord(c,entity,id,user,details){
  await c.query("insert into audit_log(user_id,action,entity_type,entity_id,details) values($1,'archive',$2,$3,$4)",[user.id,entity,id,details]);
}
async function deleteEntity(c,body,user){
  const table={property:'properties',tenant:'tenants',contract:'contracts'}[body.entity];
  if(!table||!isUuid(body.id))throw fail(400,'Registro no válido.');
  if(!['Administrador','Cobranza'].includes(user.role))throw fail(403,'Tu perfil no puede eliminar estos registros.');
  const target=(await c.query(`select * from ${table} where id=$1 for update`,[body.id])).rows[0];
  if(!target)throw fail(404,'El registro ya no existe. Actualiza la información.');
  const archived=await c.query("select id from audit_log where action='archive' and entity_type=$1 and entity_id=$2",[body.entity,body.id]);
  if(archived.rows.length)return;
  // Retire records without removing financial or maintenance history or foreign keys.
  const related=body.entity==='contract'?[target]:(await c.query(`select * from contracts where ${body.entity==='tenant'?'tenant_id':'property_id'}=$1 for update`,[body.id])).rows;
  const properties=new Set();
  for(const contract of related){
    properties.add(contract.property_id);
    const exists=await c.query("select id from audit_log where action='archive' and entity_type='contract' and entity_id=$1",[contract.id]);
    if(!exists.rows.length){
      await c.query("update contracts set status='Terminado' where id=$1",[contract.id]);
      await archiveRecord(c,'contract',contract.id,user,{name:target.name||'Contrato',terminationDate:contract.status==='Vigente'?today():null,originalEnd:dateValue(contract.end_date),reason:'Eliminación solicitada',source:body.entity});
    }
  }
  if(body.entity!=='contract')await archiveRecord(c,body.entity,body.id,user,{name:target.name,reason:'Eliminación solicitada'});
  for(const propertyId of properties){
    await c.query("update properties set status='Disponible' where id=$1 and not exists(select 1 from contracts where property_id=$1 and status='Vigente')",[propertyId]);
  }
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!process.env.DATABASE_URL)return res.status(500).json({error:'Base de datos no configurada.'});
  let c;
  try{
    c=await pool.connect();
    await c.query('begin');
    // Serialize snapshots and mutations; row locks also protect foreign-key checks.
    await c.query('select pg_advisory_xact_lock(72628419)');
    const a=await authorize(req,c);
    if(!a.ok)throw fail(a.status,a.error);
    const before=await readState(c);
    if(req.method!=='GET'){
      if(!['PUT','DELETE'].includes(req.method))throw fail(405,'Método no permitido.');
      if(req.body?.revision!==revisionOf(before))throw fail(409,'La información cambió o esta versión necesita actualizarse. Cierra y vuelve a abrir la app antes de repetir el cambio.');
      if(req.method==='DELETE')await deleteEntity(c,req.body,a.user);
      else{
        if(!req.body?.state)throw fail(400,'state requerido');
        const submitted=structuredClone(req.body.state);
        // Preserve optional new fields sent through older clients.
        for(const property of submitted.properties||[])if(property.contractDraft===undefined)property.contractDraft=before.properties.find(x=>x.id===property.id)?.contractDraft||null;
        for(const policy of submitted.insurance||[])if(policy.details===undefined)policy.details=before.insurance.find(x=>x.id===policy.id)?.details;
        const incoming=normalized(submitted);
        const denied=permissionError(a.user.role,before,incoming);
        if(denied)throw fail(403,denied);
        for(const section of ['properties','tenants','contracts','payments','credits']){
          if(before[section].some(x=>!incoming[section].some(y=>y.id===x.id)))throw fail(409,['properties','tenants'].includes(section)?'Para eliminar, abre el detalle del inmueble o inquilino y usa Eliminar. Se debe comprobar su historial primero.':'No se pueden quitar contratos, pagos ni créditos mediante la sincronización. Conserva el historial financiero.');
        }
        // Archived records remain available for history, but cannot be reactivated by a stale client.
        for(const section of ['properties','tenants','contracts'])for(const record of before[section].filter(x=>x.archivedAt)){
          const next=incoming[section].find(x=>x.id===record.id);
          if(JSON.stringify(next)!==JSON.stringify(record))throw fail(409,'Este registro está en Historial. Vuelve a abrir la app para actualizar la información.');
        }
        for(const contract of incoming.contracts.filter(x=>x.status==='Vigente')){
          if(before.tenants.some(x=>x.id===contract.tenantId&&x.archivedAt)||before.properties.some(x=>x.id===contract.propertyId&&x.archivedAt))throw fail(409,'Selecciona un inmueble y un inquilino activos para el nuevo contrato.');
        }
        for(const contract of incoming.contracts){
          const old=before.contracts.find(x=>x.id===contract.id);
          validateFiscalChange(old,contract,ym());
          if(JSON.stringify(old?.fiscal||null)!==JSON.stringify(contract.fiscal))await c.query("insert into audit_log(user_id,action,entity_type,entity_id,details) values($1,'fiscal_update','contract',$2,$3)",[a.user.id,contract.id,{before:old?.fiscal||null,after:contract.fiscal}]);
        }
        await replaceState(c,incoming,a.user,before);
      }
    }
    const state=req.method==='GET'?before:await readState(c);
    await c.query('commit');
    return res.status(200).json({ok:true,user:a.user,state,revision:revisionOf(state)});
  }catch(e){
    if(c)await c.query('rollback').catch(()=>{});
    console.error('state api:',e.message);
    return res.status(e.status||(e.code==='23503'?409:500)).json({error:e.status?e.message:e.code==='23503'?'El registro tiene información relacionada que debe conservarse.':'No fue posible sincronizar con la nube. Intenta nuevamente.'});
  }finally{c?.release()}
}
