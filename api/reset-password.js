
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

const sha256=v=>crypto.createHash("sha256").update(v).digest("hex");
const norm=v=>String(v||"").trim().toLowerCase();

async function sendResetEmail(to,url){
  const key=process.env.RESEND_API_KEY;
  if(!key)throw new Error("EMAIL_NOT_CONFIGURED");
  const from=process.env.RENTA_EMAIL_FROM||"RentaControl <onboarding@resend.dev>";
  const r=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      from,
      to:[to],
      subject:"Restablecer contraseña de RentaControl",
      html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h2>RentaControl</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${url}" style="display:inline-block;background:#284ac7;color:white;text-decoration:none;padding:12px 18px;border-radius:8px">Crear nueva contraseña</a></p>
        <p>Este enlace vence en 30 minutos y solo puede usarse una vez.</p>
        <p>Si no solicitaste el cambio, puedes ignorar este mensaje.</p>
      </div>`
    })
  });
  if(!r.ok){
    const detail=await r.text();
    console.error("Resend error",detail);
    throw new Error("EMAIL_SEND_FAILED");
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Método no permitido"});
  const client=await pool.connect();
  try{
    const action=req.body?.action;
    if(action==="request"){
      const email=norm(req.body?.email);
      if(email){
        const q=await client.query("select id,email,active from app_users where lower(email)=lower($1) limit 1",[email]);
        if(q.rows.length && q.rows[0].active){
          const token=crypto.randomBytes(32).toString("base64url");
          await client.query("delete from password_reset_tokens where user_id=$1 and used_at is null",[q.rows[0].id]);
          await client.query(
            "insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,now()+interval '30 minutes')",
            [q.rows[0].id,sha256(token)]
          );
          const proto=String(req.headers["x-forwarded-proto"]||"https").split(",")[0];
          const host=req.headers.host;
          const url=`${proto}://${host}/?reset=${encodeURIComponent(token)}`;
          try{
            await sendResetEmail(q.rows[0].email,url);
          }catch(e){
            if(e.message==="EMAIL_NOT_CONFIGURED")
              return res.status(503).json({error:"El correo de recuperación todavía no está configurado en Vercel."});
            return res.status(502).json({error:"No fue posible enviar el correo de recuperación."});
          }
        }
      }
      // Generic response prevents account enumeration.
      return res.status(200).json({ok:true});
    }

    if(action==="confirm"){
      const token=String(req.body?.token||"");
      const password=String(req.body?.password||"");
      if(password.length<8)return res.status(400).json({error:"La contraseña debe tener al menos 8 caracteres."});
      const q=await client.query(
        `select pr.id,pr.user_id
         from password_reset_tokens pr
         join app_users u on u.id=pr.user_id
         where pr.token_hash=$1 and pr.used_at is null and pr.expires_at>now() and u.active=true
         limit 1`,
        [sha256(token)]
      );
      if(!q.rows.length)return res.status(400).json({error:"El enlace es inválido o ya expiró."});
      const hash=await bcrypt.hash(password,12);
      await client.query("begin");
      try{
        await client.query("update app_users set password_hash=$1 where id=$2",[hash,q.rows[0].user_id]);
        await client.query("update password_reset_tokens set used_at=now() where id=$1",[q.rows[0].id]);
        await client.query("delete from app_sessions where user_id=$1",[q.rows[0].user_id]);
        await client.query("commit");
      }catch(e){await client.query("rollback");throw e}
      return res.status(200).json({ok:true});
    }

    return res.status(400).json({error:"Acción no válida."});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:"Error al restablecer la contraseña."});
  }finally{client.release()}
}
