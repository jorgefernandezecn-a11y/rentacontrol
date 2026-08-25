import crypto from "crypto";

const COOKIE = "rentacontrol_session";
const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");

function parseCookies(req) {
  const output = {};
  for (const pair of String(req.headers.cookie || "").split(";")) {
    const index = pair.indexOf("=");
    if (index > 0) output[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return output;
}

export async function requireSession(req, client) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const result = await client.query(
    `select u.id, u.name, u.email, u.role, u.active
       from app_sessions s
       join app_users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()
      limit 1`,
    [sha256(token)]
  );
  const user = result.rows[0];
  return user?.active ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
}

export function canAccessBusinessData(user) {
  return user && user.role !== "Mantenimiento";
}

export function canManageDocuments(user) {
  return user && ["Administrador", "Cobranza"].includes(user.role);
}
