import pg from "pg";
import crypto from "crypto";
const { Pool } = pg;
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:3});

const COOKIE="rentacontrol_session";
const sha256=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||"");
const uid=v=>isUuid(v)?v:crypto.randomUUID();
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const today=()=>new Date().toISOString().slice(0,10);
const ym=()=>new Date().toISOString().slice(0,7);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")) && !Number.isNaN(Date.parse(String(v)+"T12:00:00"));
function plusYear(d){
  const x=new Date(d+"T12:00:00");
  x.setFullYear(x.getFullYear()+1);
  return x.toISOString().slice(0,10);
}
function dateOr(v,fallback){return validDate(v)?String(v).slice(0,10):fallback}
function parseCookies(req){
  const out={};
  for(const pair of String(req.headers.cookie||"").split(";")){
    const i=pair.indexOf("=");
    if(i>0)out[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim());
  }
  return out;
}
async function authorize(req,client){
  const token=parseCookies(req)[COOKIE];
  if(!token)return{ok:false,status:401,error:"Inicia sesiÃ³n para continuar."};
  const q=await client.query(
    `select u.id,u.name,u.email,u.role,u.active,s.id session_id
     from app_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() limit 1`,[sha256(token)]);
  if(!q.rows.length)return{ok:false,status:401,error:"SesiÃ³n invÃ¡lida o expirada."};
  const u=q.rows[0];
  if(!u.active)return{ok:false,status:403,error:"Usuario desactivado."};
  await client.query("update app_sessions set last_seen_at=now() where id=$1",[u.session_id]);
  return{ok:true,user:{id:u.id,name:u.name,email:u.email,role:u.role}};
}
async function readState(client){
  const[p,t,c,pay,cr,m,ins]=await Promise.all([
    client.query("select * from properties order by created_at"),
    client.query("select * from tenants order by created_at"),
    client.query("select * from contracts order by created_at"),
    client.query("select * from payments order by payment_date, created_at"),
    client.query("select * from credits order by payment_date, created_at"),
    client.query("select * from maintenance_tasks order by task_date nulls last, created_at"),
    client.query("select * from insurance_policies order by valid_to nulls last, created_at")
  ]);
  return{
    properties:p.rows.map(x=>({id:x.id,name:x.name,type:x.type,address:x.address,rent:num(x.rent),deposit:num(x.deposit),status:x.status})),
    tenants:t.rows.map(x=>({id:x.id,name:x.name,phone:x.phone||"",email:x.email||"",securityDeposit:x.security_deposit==null?null:num(x.security_deposit),guarantor:{name:x.guarantor_name||"",phones:x.guarantor_phones||"",email:x.guarantor_email||"",address:x.guarantor_address||"",propertyType:x.guarantor_property_type||"",propertyAddress:x.guarantor_property_address||""}})),
    contracts:c.rows.map(x=>({id:x.id,propertyId:x.property_id,tenantId:x.tenant_id,start:String(x.start_date).slice(0,10),end:String(x.end_date).slice(0,10),rent:num(x.rent),dueDay:num(x.due_day,5),status:x.status})),
    payments:pay.rows.map(x=>({id:x.id,contractId:x.contract_id,period:x.period,amount:num(x.amount),date:String(x.payment_date).slice(0,10),method:x.method||"",notes:x.notes||""})),
    credits:cr.rows.map(x=>({id:x.id,contractId:x.contract_id,amount:num(x.amount),date:String(x.payment_date).slice(0,10),note:x.note||""})),
    maintenance:m.rows.map(x=>({id:x.id,title:x.title,type:x.type||"Otro",status:x.status||"Pendiente",propertyId:x.property_id||"",tenantId:x.tenant_id||"",responsible:x.responsible||"",date:x.task_date?String(x.task_date).slice(0,10):"",notes:x.notes||""})),
    insurance:ins.rows.map(x=>({id:x.id,type:x.policy_type,company:x.company,policyNumber:x.policy_number,validFrom:x.valid_from?String(x.valid_from).slice(0,10):"",validTo:x.valid_to?String(x.valid_to).slice(0,10):"",beneficiary:x.beneficiary||"",cost:num(x.cost),notes:x.notes||""})),
    agenda:[]
  };
}
const stable=x=>JSON.stringify(x||[]);
function permissionError(role,before,after){
  if(role==="Administrador"||role==="Cobranza")return null;
  const sections=["properties","tenants","contracts","payments","credits","maintenance","insurance"];
  const allowed=role==="Mantenimiento"?new Set(["maintenance"]):new Set();
  const changed=sections.filter(k=>stable(before[k])!==stable(after[k]));
  if(changed.every(k=>allowed.has(k)))return null;
  if(role==="Consulta")return"Tu perfil es de solo consulta. No tienes permiso para modificar informaciÃ³n.";
  if(role==="Mantenimiento")return"Tu perfil de Mantenimiento puede modificar Ãºnicamente mantenimientos, fallas, notas, avances y estado de trabajos.";
  return"No tienes permiso para realizar esta modificaciÃ³n.";
}
function normalized(state){
  const s=state&&typeof state==="object"?state:{};
  const properties=Array.isArray(s.properties)?s.properties:[];
  const tenants=Array.isArray(s.tenants)?s.tenants:[];
  const contracts=Array.isArray(s.contracts)?s.contracts:[];
  const payments=Array.isArray(s.payments)?s.payments:[];
  const credits=Array.isArray(s.credits)?s.credits:[];
  const maintenance=Array.isArray(s.maintenance)?s.maintenance:[];
  const insurance=Array.isArray(s.insurance)?s.insurance:[];

  // Legacy contracts sometimes had no start/end date. Recover the earliest known
  // payment month when possible; otherwise use the current date.
  for(const c of contracts){
    const firstPay=payments.filter(p=>p.contractId===c.id && /^\d{4}-\d{2}$/.test(String(p.period||""))).map(p=>p.period).sort()[0];
    const fallbackStart=firstPay?`${firstPay}-01`:today();
    c.start=dateOr(c.start,fallbackStart);
    c.end=dateOr(c.end,plusYear(c.start));
    c.dueDay=Math.min(31,Math.max(1,Math.trunc(num(c.dueDay,5))));
    c.rent=num(c.rent);
    c.status=c.status||"Vigente";
  }
  for(const p of payments){
    p.period=/^\d{4}-\d{2}$/.test(String(p.period||""))?String(p.period):ym();
    p.date=dateOr(p.date,`${p.period}-01`);
    p.amount=num(p.amount);
  }
  for(const c of credits){
    c.date=dateOr(c.date,today());
    c.amount=num(c.amount);
  }
  for(const x of properties){
    x.name=String(x.name||"Inmueble").trim()||"Inmueble";
    x.rent=num(x.rent);x.deposit=num(x.deposit);x.status=x.status||"Disponible";
  }
  for(const x of tenants)x.name=String(x.name||"Inquilino").trim()||"Inquilino";
  for(const x of maintenance){
    x.title=String(x.title||"Mantenimiento").trim()||"Mantenimiento";
    x.date=x.date&&validDate(x.date)?x.date:"";
    x.status=x.status||"Pendiente";
  }
  for(const x of insurance){
    x.type=["Coche","Inmueble","Gastos mÃ©dicos","Vida"].includes(x.type)?x.type:"Inmueble";
    x.company=String(x.company||"").trim();x.policyNumber=String(x.policyNumber||"").trim();
    x.validFrom=x.validFrom&&validDate(x.validFrom)?x.validFrom:"";x.validTo=x.validTo&&validDate(x.validTo)?x.validTo:"";
    x.beneficiary=String(x.beneficiary||"").trim();x.cost=num(x.cost);x.notes=String(x.notes||"");
  }
  return{properties,tenants,contracts,payments,credits,maintenance,insurance,agenda:[]};
}
async function replaceState(client,input){
  const state=normalized(structuredClone(input));
  const pMap=new Map(),tMap=new Map(),cMap=new Map();
  for(const x of state.properties)pMap.set(x.id,uid(x.id));
  for(const x of state.tenants)tMap.set(x.id,uid(x.id));
  for(const x of state.contracts)cMap.set(x.id,uid(x.id));

  await client.query("begin");
  try{
    await client.query("delete from insurance_policies");
    await client.query("delete from payments");
    await client.query("delete from credits");
    await client.query("delete from maintenance_tasks");
    await client.query("delete from contracts");
    await client.query("delete from tenants");
    await client.query("delete from properties");

    for(const x of state.properties)
      await client.query(`insert into properties(id,name,type,address,rent,deposit,status) values($1,$2,$3,$4,$5,$6,$7)`,
        [pMap.get(x.id),x.name,x.type||null,x.address||null,x.rent,x.deposit,x.status]);

    for(const x of state.tenants){
      const g=x.guarantor||{};
      await client.query(`insert into tenants(id,name,phone,email,security_deposit,guarantor_name,guarantor_phones,guarantor_email,guarantor_address,guarantor_property_type,guarantor_property_address)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tMap.get(x.id),x.name,x.phone||null,x.email||null,x.securityDeposit==null?null:num(x.securityDeposit),g.name||null,g.phones||null,g.email||null,g.address||null,g.propertyType||null,g.propertyAddress||null]);
    }

    for(const x of state.contracts){
      const pid=pMap.get(x.propertyId),tid=tMap.get(x.tenantId);
      if(!pid||!tid)continue;
      await client.query(`insert into contracts(id,property_id,tenant_id,start_date,end_date,rent,due_day,status) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cMap.get(x.id),pid,tid,x.start,x.end,x.rent,x.dueDay,x.status]);
    }

    for(const x of state.payments){
      const cid=cMap.get(x.contractId);if(!cid)continue;
      await client.query(`insert into payments(id,contract_id,period,amount,payment_date,method,notes) values($1,$2,$3,$4,$5,$6,$7)`,
        [uid(x.id),cid,x.period,x.amount,x.date,x.method||null,x.notes||null]);
    }
    for(const x of state.credits){
      const cid=cMap.get(x.contractId);if(!cid)continue;
      await client.query(`insert into credits(id,contract_id,amount,payment_date,note) values($1,$2,$3,$4,$5)`,
        [uid(x.id),cid,x.amount,x.date,x.note||null]);
    }
    for(const x of state.maintenance){
      await client.query(`insert into maintenance_tasks(id,title,type,status,property_id,tenant_id,responsible,task_date,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uid(x.id),x.title,x.type||null,x.status,x.propertyId?pMap.get(x.propertyId)||null:null,x.tenantId?tMap.get(x.tenantId)||null:null,x.responsible||null,x.date||null,x.notes||null]);
    }
    for(const x of state.insurance){
      if(!x.company||!x.policyNumber)continue;
      await client.query(`insert into insurance_policies(id,policy_type,company,policy_number,valid_from,valid_to,beneficiary,cost,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uid(x.id),x.type,x.company,x.policyNumber,x.validFrom||null,x.validTo||null,x.beneficiary||null,x.cost,x.notes||null]);
    }
    await client.query("commit");
  }catch(e){
    await client.query("rollback");
    throw e;
  }
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(!process.env.DATABASE_URL)return res.status(500).json({error:"Base de datos no configurada."});
  const client=await pool.connect();
  try{
    const a=await authorize(req,client);
    if(!a.ok)return res.status(a.status).json({error:a.error});
    if(req.method==="GET")return res.status(200).json({ok:true,user:a.user,state:await readState(client)});
    if(req.method==="PUT"){
      if(!req.body?.state)return res.status(400).json({error:"state requerido"});
      const incoming=normalized(structuredClone(req.body.state));
      const before=await readState(client);
      const denied=permissionError(a.user.role,before,incoming);
      if(denied)return res.status(403).json({error:denied});
      await replaceState(client,incoming);
      return res.status(200).json({ok:true,user:a.user,state:await readState(client)});
    }
    return res.status(405).json({error:"MÃ©todo no permitido"});
  }catch(e){
    console.error("state api:",e);
    return res.status(500).json({error:"No fue posible sincronizar con la nube.",detail:e.message});
  }finally{client.release()}
}
