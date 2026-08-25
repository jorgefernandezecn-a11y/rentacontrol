import pg from "pg";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { canAccessBusinessData, requireSession } from "./_session.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const money = value => Number(value || 0);
const currency = value => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(money(value));
const monthPattern = /^\d{4}-\d{2}$/;
const dateKey = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || "");
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

function monthRange(start, end) {
  const output = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T12:00:00`);
  const limit = new Date(`${end.slice(0, 7)}-01T12:00:00`);
  while (cursor <= limit) {
    output.push(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return output;
}

async function loadData(client) {
  const [properties, tenants, contracts, payments, credits] = await Promise.all([
    client.query("select id,name,type,address,rent,status from properties order by name"),
    client.query("select id,name,email,phone from tenants order by name"),
    client.query("select id,property_id,tenant_id,start_date,end_date,rent,due_day,status from contracts order by start_date"),
    client.query("select id,contract_id,period,amount,payment_date,method,notes from payments order by payment_date,created_at"),
    client.query("select id,contract_id,amount,payment_date,note from credits order by payment_date,created_at")
  ]);
  return { properties: properties.rows, tenants: tenants.rows, contracts: contracts.rows, payments: payments.rows, credits: credits.rows };
}

export function makeReport(data, level, period, contractId) {
  const propertyById = new Map(data.properties.map(item => [item.id, item]));
  const tenantById = new Map(data.tenants.map(item => [item.id, item]));
  const active = data.contracts.filter(item => item.status === "Vigente");
  const paymentFor = (contract, targetPeriod) => data.payments.filter(item => item.contract_id === contract.id && item.period === targetPeriod).reduce((sum, item) => sum + money(item.amount), 0);
  const balances = active.map(contract => {
    const rent = money(contract.rent);
    const paid = paymentFor(contract, period);
    return { contract, property: propertyById.get(contract.property_id), tenant: tenantById.get(contract.tenant_id), rent, paid, balance: rent - paid };
  });

  if (level === "statement") {
    const contract = data.contracts.find(item => item.id === contractId);
    if (!contract) throw Object.assign(new Error("Contrato no encontrado."), { status: 404 });
    const property = propertyById.get(contract.property_id);
    const tenant = tenantById.get(contract.tenant_id);
    const endPeriod = period;
    let running = 0;
    const rows = [];
    for (const targetPeriod of monthRange(dateKey(contract.start_date), `${endPeriod}-01`)) {
      const charge = money(contract.rent);
      const payments = paymentFor(contract, targetPeriod);
      running += charge - payments;
      rows.push({ period: targetPeriod, concept: "Renta mensual", charge, payment: payments, balance: running });
      for (const credit of data.credits.filter(item => item.contract_id === contract.id && dateKey(item.payment_date).slice(0, 7) === targetPeriod)) {
        running -= money(credit.amount);
        rows.push({ period: dateKey(credit.payment_date), concept: credit.note || "Anticipo / pago a cuenta", charge: 0, payment: money(credit.amount), balance: running });
      }
    }
    return { level, period, property, tenant, contract, rows, totalCharges: rows.reduce((sum, row) => sum + row.charge, 0), totalPaid: rows.reduce((sum, row) => sum + row.payment, 0), balance: running };
  }

  const expected = balances.reduce((sum, row) => sum + row.rent, 0);
  const paid = balances.reduce((sum, row) => sum + row.paid, 0);
  const pending = balances.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  const occupied = data.properties.filter(item => item.status === "Rentada").length;
  return { level, period, balances, properties: data.properties, expected, paid, pending, overdue: balances.filter(row => row.balance > 0 && new Date().getDate() > money(row.contract.due_day || 5)).length, occupancy: data.properties.length ? occupied / data.properties.length : 0 };
}

function styleSheet(sheet, widths) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8A2E39" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 24;
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(widths.length).address };
  sheet.eachRow((row, index) => {
    if (index > 1 && index % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F2F3" } };
  });
}

export async function buildWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RentaControl";
  workbook.created = new Date();
  if (report.level === "general") {
    const summary = workbook.addWorksheet("Resumen");
    summary.addRow(["Indicador", "Valor"]);
    summary.addRows([["Periodo", report.period], ["Renta esperada", report.expected], ["Cobrado", report.paid], ["Pendiente", report.pending], ["Pagos vencidos", report.overdue], ["Ocupación", report.occupancy]]);
    styleSheet(summary, [28, 22]);
    [3, 4, 5].forEach(row => { summary.getCell(`B${row}`).numFmt = '"$"#,##0.00'; });
    summary.getCell("B7").numFmt = "0%";
    const portfolio = workbook.addWorksheet("Cartera");
    portfolio.addRow(["Inmueble", "Tipo", "Dirección", "Estado", "Renta"]);
    report.properties.forEach(item => portfolio.addRow([item.name, item.type, item.address, item.status, money(item.rent)]));
    styleSheet(portfolio, [26, 18, 42, 16, 18]);
    portfolio.getColumn(5).numFmt = '"$"#,##0.00';
  } else if (report.level === "balances") {
    const sheet = workbook.addWorksheet("Saldos");
    sheet.addRow(["Periodo", "Inmueble", "Inquilino", "Renta", "Pagos", "Saldo"]);
    report.balances.forEach(row => sheet.addRow([report.period, row.property?.name || "", row.tenant?.name || "", row.rent, row.paid, row.balance]));
    sheet.addRow(["", "", "TOTAL", report.expected, report.paid, report.pending]);
    styleSheet(sheet, [14, 28, 28, 18, 18, 18]);
    [4, 5, 6].forEach(column => { sheet.getColumn(column).numFmt = '"$"#,##0.00'; });
    sheet.lastRow.font = { bold: true };
  } else {
    const sheet = workbook.addWorksheet("Estado de cuenta");
    sheet.addRow(["Fecha / periodo", "Concepto", "Cargo", "Pago / anticipo", "Saldo"]);
    report.rows.forEach(row => sheet.addRow([row.period, row.concept, row.charge, row.payment, row.balance]));
    sheet.addRow(["", "TOTAL", report.totalCharges, report.totalPaid, report.balance]);
    styleSheet(sheet, [18, 32, 18, 20, 18]);
    [3, 4, 5].forEach(column => { sheet.getColumn(column).numFmt = '"$"#,##0.00'; });
    sheet.lastRow.font = { bold: true };
    sheet.headerFooter.oddHeader = `&L&BEstado de cuenta - ${report.tenant?.name || "Inquilino"}&R${report.property?.name || ""}`;
  }
  return workbook.xlsx.writeBuffer();
}

function drawTable(doc, headers, rows, widths) {
  const left = doc.page.margins.left;
  const drawRow = (cells, header = false) => {
    const height = 24;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = left;
    if (header) doc.rect(left, y, widths.reduce((a, b) => a + b, 0), height).fill("#8A2E39");
    cells.forEach((cell, index) => {
      doc.fillColor(header ? "#FFFFFF" : "#172033").font(header ? "Helvetica-Bold" : "Helvetica").fontSize(8).text(String(cell ?? ""), x + 5, y + 7, { width: widths[index] - 10, height: 12, ellipsis: true, lineBreak: false });
      x += widths[index];
    });
    doc.y = y + height;
    doc.moveTo(left, doc.y).lineTo(left + widths.reduce((a, b) => a + b, 0), doc.y).strokeColor("#E5E9F0").stroke();
  };
  drawRow(headers, true);
  rows.forEach(row => drawRow(row));
}

export async function buildPdf(report) {
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: "Reporte RentaControl", Author: "RentaControl" } });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.fillColor("#8A2E39").font("Helvetica-Bold").fontSize(22).text("RentaControl");
  doc.fillColor("#172033").fontSize(15).text(report.level === "statement" ? "Estado de cuenta" : report.level === "balances" ? "Reporte general de saldos" : "Reporte general");
  doc.fillColor("#6D7687").font("Helvetica").fontSize(9).text(`Periodo: ${report.period}  |  Generado: ${new Date().toLocaleDateString("es-MX")}`);
  doc.moveDown();
  if (report.level === "statement") {
    doc.fillColor("#172033").font("Helvetica-Bold").fontSize(13).text(report.tenant?.name || "Inquilino");
    doc.font("Helvetica").fontSize(10).text(`${report.property?.name || ""}${report.property?.address ? ` - ${report.property.address}` : ""}`);
    if (report.tenant?.email) doc.text(report.tenant.email);
    doc.moveDown();
    drawTable(doc, ["Periodo", "Concepto", "Cargo", "Pago", "Saldo"], report.rows.map(row => [row.period, row.concept, currency(row.charge), currency(row.payment), currency(row.balance)]), [75, 155, 90, 90, 90]);
    doc.moveDown().font("Helvetica-Bold").fontSize(12).fillColor("#8A2E39").text(`Saldo actual: ${currency(report.balance)}`, { align: "right" });
    const footerY = doc.y + 28;
    doc.fillColor("#6D7687").font("Helvetica").fontSize(8).text("Documento informativo generado por RentaControl. Los pagos están sujetos a conciliación administrativa.", doc.page.margins.left, footerY, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center" });
  } else {
    doc.fillColor("#172033").font("Helvetica-Bold").fontSize(11).text(`Esperado: ${currency(report.expected)}   Cobrado: ${currency(report.paid)}   Pendiente: ${currency(report.pending)}`);
    doc.moveDown();
    if (report.level === "general") drawTable(doc, ["Inmueble", "Tipo", "Dirección", "Estado", "Renta"], report.properties.map(item => [item.name, item.type || "", item.address || "", item.status || "", currency(item.rent)]), [110, 70, 165, 70, 85]);
    else drawTable(doc, ["Inmueble", "Inquilino", "Renta", "Pagos", "Saldo"], report.balances.map(row => [row.property?.name || "", row.tenant?.name || "", currency(row.rent), currency(row.paid), currency(row.balance)]), [120, 120, 85, 85, 90]);
  }
  doc.end();
  return done;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: "Base de datos no configurada." });
  const level = ["general", "balances", "statement"].includes(req.query?.level) ? req.query.level : "general";
  const format = req.query?.format === "xlsx" ? "xlsx" : "pdf";
  const period = monthPattern.test(String(req.query?.period || "")) ? String(req.query.period) : new Date().toISOString().slice(0, 7);
  const client = await pool.connect();
  try {
    const user = await requireSession(req, client);
    if (!user) return res.status(401).json({ error: "Inicia sesión para continuar." });
    if (!canAccessBusinessData(user)) return res.status(403).json({ error: "Tu perfil no tiene acceso a reportes financieros." });
    const report = makeReport(await loadData(client), level, period, String(req.query?.contractId || ""));
    const output = format === "xlsx" ? await buildWorkbook(report) : await buildPdf(report);
    const base = level === "statement" ? `estado-cuenta-${report.tenant?.name || "inquilino"}` : level === "balances" ? "reporte-saldos" : "reporte-general";
    const filename = `${base.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${period}.${format}`;
    res.setHeader("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(output));
  } catch (error) {
    console.error("reports:", error);
    return res.status(error.status || 500).json({ error: error.message || "No fue posible generar el reporte." });
  } finally {
    client.release();
  }
}
