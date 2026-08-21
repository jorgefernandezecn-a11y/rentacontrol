
import pg from "pg";
import crypto from "crypto";
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || "");
const uid = (v) => isUuid(v) ? v : crypto.randomUUID();


const COOKIE="rentacontrol_session";
const sha256=v=>crypto.createHash("sha256").update(v).digest("hex");
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
  if(!token)return {ok:false,status:401,error:"Inicia sesión para continuar."};
  const q=await client.query(
    `select u.id,u.name,u.email,u.role,u.active,s.id session_id
     from app_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() limit 1`,
    [sha256(token)]
  );
  if(!q.rows.length)return {ok:false,status:401,error:"Sesión inválida o expirada."};
  const u=q.rows[0];
  if(!u.active)return {ok:false,status:403,error:"Usuario desactivado."};
  await client.query("update app_sessions set last_seen_at=now() where id=$1",[u.session_id]);
  return {ok:true,user:{id:u.id,name:u.name,email:u.email,role:u.role}};
}

async function readState(client) {
  const [p,t,c,pay,cr,m] = await Promise.all([
    client.query("select * from properties order by created_at"),
    client.query("select * from tenants order by created_at"),
    client.query("select * from contracts order by created_at"),
    client.query("select * from payments order by payment_date, created_at"),
    client.query("select * from credits order by payment_date, created_at"),
    client.query("select * from maintenance_tasks order by task_date nulls last, created_at")
  ]);
  return {
    properties:p.rows.map(x=>({id:x.id,name:x.name,type:x.type,address:x.address,rent:Number(x.rent||0),deposit:Number(x.deposit||0),status:x.status})),
    tenants:t.rows.map(x=>({id:x.id,name:x.name,phone:x.phone||"",email:x.email||"",securityDeposit:x.security_deposit==null?null:Number(x.security_deposit),guarantor:{name:x.guarantor_name||"",phones:x.guarantor_phones||"",email:x.guarantor_email||"",address:x.guarantor_address||"",propertyType:x.guarantor_property_type||"",propertyAddress:x.guarantor_property_address||""}})),
    contracts:c.rows.map(x=>({id:x.id,propertyId:x.property_id,tenantId:x.tenant_id,start:String(x.start_date).slice(0,10),end:String(x.end_date).slice(0,10),rent:Number(x.rent||0),dueDay:x.due_day,status:x.status})),
    payments:pay.rows.map(x=>({id:x.id,contractId:x.contract_id,period:x.period,amount:Number(x.amount||0),date:String(x.payment_date).slice(0,10),method:x.method||"",notes:x.notes||""})),
    credits:cr.rows.map(x=>({id:x.id,contractId:x.contract_id,amount:Number(x.amount||0),date:String(x.payment_date).slice(0,10),note:x.note||""})),
    maintenance:m.rows.map(x=>({id:x.id,title:x.title,type:x.type||"Otro",status:x.status||"Pendiente",propertyId:x.property_id||"",tenantId:x.tenant_id||"",responsible:x.responsible||"",date:x.task_date?String(x.task_date).slice(0,10):"",notes:x.notes||""})),
    agenda:[]
  };
}

async function replaceState(client,state){
  const pMap=new Map(),tMap=new Map(),cMap=new Map();
  for(const x of state.properties||[])pMap.set(x.id,uid(x.id));
  for(const x of state.tenants||[])tMap.set(x.id,uid(x.id));
  for(const x of state.contracts||[])cMap.set(x.id,uid(x.id));
  await client.query("begin");
  try{
    await client.query("delete from payments");await client.query("delete from credits");await client.query("delete from maintenance_tasks");await client.query("delete from contracts");await client.query("delete from tenants");await client.query("delete from properties");
    for(const x of state.properties||[])await client.query(`insert into properties(id,name,type,address,rent,deposit,status) values($1,$2,$3,$4,$5,$6,$7)`,[pMap.get(x.id),x.name,x.type||null,x.address||null,Number(x.rent||0),Number(x.deposit||0),x.status||"Disponible"]);
    for(const x of state.tenants||[]){const g=x.guarantor||{};await client.query(`insert into tenants(id,name,phone,email,security_deposit,guarantor_name,guarantor_phones,guarantor_email,guarantor_address,guarantor_property_type,guarantor_property_address) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[tMap.get(x.id),x.name,x.phone||null,x.email||null,x.securityDeposit==null?null:Number(x.securityDeposit),g.name||null,g.phones||null,g.email||null,g.address||null,g.propertyType||null,g.propertyAddress||null]);}
    for(const x of state.contracts||[]){if(!pMap.get(x.propertyId)||!tMap.get(x.tenantId))continue;await client.query(`insert into contracts(id,property_id,tenant_id,start_date,end_date,rent,due_day,status) values($1,$2,$3,$4,$5,$6,$7,$8)`,[cMap.get(x.id),pMap.get(x.propertyId),tMap.get(x.tenantId),x.start,x.end,Number(x.rent||0),Number(x.dueDay||5),x.status||"Vigente"]);}
    for(const x of state.payments||[]){const cid=cMap.get(x.contractId);if(!cid)continue;await client.query(`insert into payments(id,contract_id,period,amount,payment_date,method,notes) values($1,$2,$3,$4,$5,$6,$7)`,[uid(x.id),cid,x.period,Number(x.amount||0),x.date,x.method||null,x.notes||null]);}
    for(const x of state.credits||[]){const cid=cMap.get(x.contractId);if(!cid)continue;await client.query(`insert into credits(id,contract_id,amount,payment_date,note) values($1,$2,$3,$4,$5)`,[uid(x.id),cid,Number(x.amount||0),x.date,x.note||null]);}
    for(const x of state.maintenance||[])await client.query(`insert into maintenance_tasks(id,title,type,status,property_id,tenant_id,responsible,task_date,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[uid(x.id),x.title,x.type||null,x.status||"Pendiente",x.propertyId?pMap.get(x.propertyId)||null:null,x.tenantId?tMap.get(x.tenantId)||null:null,x.responsible||null,x.date||null,x.notes||null]);
    await client.query("commit");
  }catch(e){await client.query("rollback");throw e}
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(!process.env.DATABASE_URL)return res.status(500).json({error:"Base de datos no configurada."});
  const client=await pool.connect();
  try{
    const a=await authorize(req,client);
    if(!a.ok)return res.status(a.status).json({error:a.error});
    if(req.method==="GET")return res.status(200).json({ok:true,user:a.user,state:await readState(client)});
    if(req.method==="PUT"){const state=req.body?.state;if(!state)return res.status(400).json({error:"state requerido"});await replaceState(client,state);return res.status(200).json({ok:true,user:a.user,state:await readState(client)})}
    return res.status(405).json({error:"Método no permitido"});
  }catch(e){console.error(e);return res.status(500).json({error:"Error de base de datos",detail:e.message})}
  finally{client.release()}
}
