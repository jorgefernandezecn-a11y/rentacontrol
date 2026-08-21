
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

const COOKIE="rentacontrol_session";
const sha256=v=>crypto.createHash("sha256").update(v).digest("hex");
const norm=v=>String(v||"").trim().toLowerCase();

function parseCookies(req){
  const out={};
  for(const pair of String(req.headers.cookie||"").split(";")){
    const i=pair.indexOf("=");
    if(i>0)out[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim());
  }
  return out;
}
async function currentUser(req,client){
  const token=parseCookies(req)[COOKIE];
  if(!token)return null;
  const q=await client.query(
    `select u.id,u.name,u.email,u.role,u.active
     from app_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() limit 1`,
    [sha256(token)]
  );
  return q.rows[0]||null;
}
const roles=["Administrador","Cobranza","Mantenimiento","Consulta"];

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const client=await pool.connect();
  try{
    const me=await currentUser(req,client);
    if(!me)return res.status(401).json({error:"Inicia sesión para continuar."});
    if(me.role!=="Administrador")return res.status(403).json({error:"Solo un Administrador puede gestionar usuarios."});

    if(req.method==="GET"){
      const q=await client.query(
        `select id,name,email,role,active,language,currency,created_at
         from app_users order by created_at`
      );
      return res.status(200).json({ok:true,users:q.rows});
    }

    if(req.method==="POST"){
      const action=req.body?.action;
      if(action==="create"){
        const name=String(req.body?.name||"").trim();
        const email=norm(req.body?.email);
        const role=String(req.body?.role||"Consulta");
        const password=String(req.body?.password||"");
        if(!name||!email)return res.status(400).json({error:"Nombre y correo son requeridos."});
        if(!roles.includes(role))return res.status(400).json({error:"Rol no válido."});
        if(password.length<8)return res.status(400).json({error:"La contraseña temporal debe tener al menos 8 caracteres."});
        const exists=await client.query("select id from app_users where lower(email)=lower($1) limit 1",[email]);
        if(exists.rows.length)return res.status(409).json({error:"Ya existe un usuario con ese correo."});
        const hash=await bcrypt.hash(password,12);
        const q=await client.query(
          `insert into app_users(name,email,role,active,password_hash)
           values($1,$2,$3,true,$4)
           returning id,name,email,role,active,language,currency,created_at`,
          [name,email,role,hash]
        );
        return res.status(200).json({ok:true,user:q.rows[0]});
      }

      if(action==="update"){
        const id=String(req.body?.id||"");
        const name=String(req.body?.name||"").trim();
        const email=norm(req.body?.email);
        const role=String(req.body?.role||"Consulta");
        const active=!!req.body?.active;
        if(!id||!name||!email)return res.status(400).json({error:"Datos incompletos."});
        if(!roles.includes(role))return res.status(400).json({error:"Rol no válido."});
        if(id===me.id && (!active || role!=="Administrador"))
          return res.status(400).json({error:"No puedes quitarte a ti mismo el acceso de Administrador."});
        const dup=await client.query("select id from app_users where lower(email)=lower($1) and id<>$2 limit 1",[email,id]);
        if(dup.rows.length)return res.status(409).json({error:"Ese correo ya está en uso."});
        const q=await client.query(
          `update app_users set name=$1,email=$2,role=$3,active=$4
           where id=$5 returning id,name,email,role,active,language,currency,created_at`,
          [name,email,role,active,id]
        );
        if(!q.rows.length)return res.status(404).json({error:"Usuario no encontrado."});
        if(!active)await client.query("delete from app_sessions where user_id=$1",[id]);
        return res.status(200).json({ok:true,user:q.rows[0]});
      }

      if(action==="reset_password"){
        const id=String(req.body?.id||"");
        const password=String(req.body?.password||"");
        if(password.length<8)return res.status(400).json({error:"La contraseña debe tener al menos 8 caracteres."});
        const hash=await bcrypt.hash(password,12);
        const q=await client.query("update app_users set password_hash=$1 where id=$2 returning id",[hash,id]);
        if(!q.rows.length)return res.status(404).json({error:"Usuario no encontrado."});
        await client.query("delete from app_sessions where user_id=$1",[id]);
        return res.status(200).json({ok:true});
      }

      return res.status(400).json({error:"Acción no válida."});
    }

    return res.status(405).json({error:"Método no permitido"});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:"Error al gestionar usuarios."});
  }finally{
    client.release();
  }
}
