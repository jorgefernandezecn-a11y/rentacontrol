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
const DAYS=14;
const sha256=v=>crypto.createHash("sha256").update(v).digest("hex");
const normalizeEmail=v=>String(v||"").trim().toLowerCase();

function cookies(req){
  const out={};
  for(const pair of String(req.headers.cookie||"").split(";")){
    const i=pair.indexOf("=");
    if(i>0)out[pair.slice(0,i).trim()]=decodeURIComponent(pair.slice(i+1).trim());
  }
  return out;
}
function setSessionCookie(res,token){
  const maxAge=DAYS*24*60*60;
  res.setHeader("Set-Cookie",`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);
}
function clearSessionCookie(res){
  res.setHeader("Set-Cookie",`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

async function createSession(client,userId){
  const token=crypto.randomBytes(32).toString("base64url");
  const expires=new Date(Date.now()+DAYS*86400000);
  await client.query(
    "insert into app_sessions(user_id,token_hash,expires_at) values($1,$2,$3)",
    [userId,sha256(token),expires]
  );
  return token;
}

async function sessionUser(req,client){
  const token=cookies(req)[COOKIE];
  if(!token)return null;
  const q=await client.query(
    `select u.id,u.name,u.email,u.role,u.active,s.id session_id
     from app_sessions s join app_users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() limit 1`,
    [sha256(token)]
  );
  if(!q.rows.length)return null;
  const u=q.rows[0];
  if(!u.active)return null;
  await client.query("update app_sessions set last_seen_at=now() where id=$1",[u.session_id]);
  return {id:u.id,name:u.name,email:u.email,role:u.role};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(!process.env.DATABASE_URL)return res.status(500).json({error:"Base de datos no configurada."});
  const client=await pool.connect();
  try{
    if(req.method==="GET" && req.query?.action==="session"){
      const user=await sessionUser(req,client);
      if(!user)return res.status(401).json({error:"Sin sesiÃ³n"});
      return res.status(200).json({ok:true,user});
    }
    if(req.method!=="POST")return res.status(405).json({error:"MÃ©todo no permitido"});
    const action=req.body?.action;

    if(action==="logout"){
      const token=cookies(req)[COOKIE];
      if(token)await client.query("delete from app_sessions where token_hash=$1",[sha256(token)]);
      clearSessionCookie(res);
      return res.status(200).json({ok:true});
    }

    if(action==="change_password"){
      const user=await sessionUser(req,client);
      if(!user)return res.status(401).json({error:"SesiÃ³n invÃ¡lida o expirada."});
      const currentPassword=String(req.body?.currentPassword||"");
      const newPassword=String(req.body?.newPassword||"");
      if(newPassword.length<8)return res.status(400).json({error:"La nueva contraseÃ±a debe tener al menos 8 caracteres."});
      const q=await client.query("select password_hash from app_users where id=$1",[user.id]);
      if(!q.rows.length||!q.rows[0].password_hash)return res.status(400).json({error:"La cuenta no tiene contraseÃ±a configurada."});
      const good=await bcrypt.compare(currentPassword,q.rows[0].password_hash);
      if(!good)return res.status(401).json({error:"La contraseÃ±a actual no es correcta."});
      const hash=await bcrypt.hash(newPassword,12);
      await client.query("update app_users set password_hash=$1 where id=$2",[hash,user.id]);
      await client.query("delete from app_sessions where user_id=$1",[user.id]);
      const token=await createSession(client,user.id);
      setSessionCookie(res,token);
      return res.status(200).json({ok:true,user});
    }

    const email=normalizeEmail(req.body?.email);
    const password=String(req.body?.password||"");
    if(!email || password.length<8)return res.status(400).json({error:"Correo vÃ¡lido y contraseÃ±a de al menos 8 caracteres requeridos."});

    if(action==="signup"){
      const admin=normalizeEmail(process.env.RENTA_ADMIN_EMAIL);
      if(!admin || email!==admin)return res.status(403).json({error:"Este correo no estÃ¡ autorizado para crear la cuenta administradora."});

      const existing=await client.query("select id,password_hash from app_users where lower(email)=lower($1) limit 1",[email]);
      let userId;
      const hash=await bcrypt.hash(password,12);

      if(existing.rows.length){
        if(existing.rows[0].password_hash)return res.status(409).json({error:"La cuenta ya existe. Usa Iniciar sesiÃ³n."});
        userId=existing.rows[0].id;
        await client.query(
          "update app_users set name=$1,password_hash=$2,role='Administrador',active=true where id=$3",
          [String(req.body?.name||"Administrador"),hash,userId]
        );
      }else{
        const ins=await client.query(
          `insert into app_users(name,email,role,active,password_hash)
           values($1,$2,'Administrador',true,$3) returning id`,
          [String(req.body?.name||"Administrador"),email,hash]
        );
        userId=ins.rows[0].id;
      }

      await client.query("delete from app_sessions where user_id=$1",[userId]);
      const token=await createSession(client,userId);
      setSessionCookie(res,token);
      return res.status(200).json({ok:true,user:{id:userId,name:String(req.body?.name||"Administrador"),email,role:"Administrador"}});
    }

    if(action==="login"){
      const q=await client.query(
        "select id,name,email,role,active,password_hash from app_users where lower(email)=lower($1) limit 1",
        [email]
      );
      if(!q.rows.length || !q.rows[0].password_hash)return res.status(401).json({error:"Correo o contraseÃ±a incorrectos."});
      const u=q.rows[0];
      if(!u.active)return res.status(403).json({error:"Usuario desactivado."});
      const good=await bcrypt.compare(password,u.password_hash);
      if(!good)return res.status(401).json({error:"Correo o contraseÃ±a incorrectos."});

      await client.query("delete from app_sessions where expires_at<=now()");
      const token=await createSession(client,u.id);
      setSessionCookie(res,token);
      return res.status(200).json({ok:true,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
    }

    return res.status(400).json({error:"AcciÃ³n no vÃ¡lida."});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:"Error de autenticaciÃ³n."});
  }finally{
    client.release();
  }
}
