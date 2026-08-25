import pg from "pg";
import { del, get, put } from "@vercel/blob";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { canAccessBusinessData, canManageDocuments, requireSession } from "./_session.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const allowedTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf", "text/rtf", "text/plain", "text/csv",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet"
]);
const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "txt", "csv", "odt", "ods"]);
const maxBytes = 4 * 1024 * 1024;
const safeName = value => String(value || "archivo").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
const sendError = (res, status, error) => res.status(status).json({ error });

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.DATABASE_URL) return sendError(res, 500, "Base de datos no configurada.");
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return sendError(res, 500, "Almacenamiento de documentos no configurado.");
  const client = await pool.connect();
  try {
    const user = await requireSession(req, client);
    if (!user) return sendError(res, 401, "Inicia sesión para continuar.");
    if (!canAccessBusinessData(user)) return sendError(res, 403, "Tu perfil no tiene acceso a documentos de seguros.");

    if (req.method === "GET" && req.query?.download) {
      const record = await client.query("select original_name,mime_type,blob_url from insurance_documents where id=$1 limit 1", [req.query.download]);
      if (!record.rows.length) return sendError(res, 404, "Documento no encontrado.");
      const document = record.rows[0], blob = await get(document.blob_url, { access: "private" });
      if (!blob || blob.statusCode !== 200) return sendError(res, 404, "Archivo no encontrado en almacenamiento.");
      res.setHeader("Content-Type", document.mime_type);
      res.setHeader("Content-Disposition", `${req.query.inline === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.original_name)}`);
      return Readable.fromWeb(blob.stream).pipe(res);
    }

    if (req.method === "GET") {
      const policyId = String(req.query?.policyId || "");
      if (!policyId) return sendError(res, 400, "policyId requerido.");
      const rows = await client.query(
        `select id,insurance_policy_id,display_name,description,document_date,original_name,mime_type,size_bytes,created_at
         from insurance_documents where insurance_policy_id=$1 order by document_date desc,created_at desc`, [policyId]
      );
      return res.status(200).json({ ok: true, documents: rows.rows });
    }

    if (req.method === "POST") {
      if (!canManageDocuments(user)) return sendError(res, 403, "Solo Administrador o Cobranza pueden subir documentos.");
      const policyId = String(req.headers["x-policy-id"] || "");
      const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "archivo"));
      const displayName = decodeURIComponent(String(req.headers["x-display-name"] || originalName)).trim().slice(0, 160);
      const description = decodeURIComponent(String(req.headers["x-description"] || "")).trim().slice(0, 1000);
      const documentDate = String(req.headers["x-document-date"] || new Date().toISOString().slice(0, 10));
      const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].toLowerCase();
      const extension = originalName.toLowerCase().split(".").pop();
      if (!policyId || !displayName) return sendError(res, 400, "Póliza y nombre son requeridos.");
      if (!allowedTypes.has(mimeType) || !allowedExtensions.has(extension)) return sendError(res, 415, "Formato no permitido.");
      const exists = await client.query("select 1 from insurance_policies where id=$1", [policyId]);
      if (!exists.rows.length) return sendError(res, 404, "Póliza no encontrada.");
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) return sendError(res, 413, "El archivo supera el límite de 4 MB.");
        chunks.push(chunk);
      }
      if (!size) return sendError(res, 400, "Archivo vacío.");
      const pathname = `insurance/${policyId}/${crypto.randomUUID()}-${safeName(originalName)}`;
      const blob = await put(pathname, Buffer.concat(chunks), { access: "private", contentType: mimeType, addRandomSuffix: false });
      try {
        const inserted = await client.query(
          `insert into insurance_documents(insurance_policy_id,display_name,description,document_date,original_name,mime_type,size_bytes,blob_url,blob_pathname,uploaded_by)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning id,insurance_policy_id,display_name,description,document_date,original_name,mime_type,size_bytes,created_at`,
          [policyId, displayName, description || null, documentDate, originalName, mimeType, size, blob.url, blob.pathname, user.id]
        );
        return res.status(201).json({ ok: true, document: inserted.rows[0] });
      } catch (error) { await del(blob.url).catch(() => {}); throw error; }
    }

    if (req.method === "DELETE") {
      if (!canManageDocuments(user)) return sendError(res, 403, "Solo Administrador o Cobranza pueden eliminar documentos.");
      const id = String(req.query?.id || "");
      const record = await client.query("select blob_url from insurance_documents where id=$1 limit 1", [id]);
      if (!record.rows.length) return sendError(res, 404, "Documento no encontrado.");
      await del(record.rows[0].blob_url);
      await client.query("delete from insurance_documents where id=$1", [id]);
      return res.status(200).json({ ok: true });
    }
    return sendError(res, 405, "Método no permitido.");
  } catch (error) {
    console.error("insurance documents:", error);
    return sendError(res, 500, "No fue posible procesar el documento de la póliza.");
  } finally { client.release(); }
}
