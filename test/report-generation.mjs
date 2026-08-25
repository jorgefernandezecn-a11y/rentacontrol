import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { buildPdf, buildWorkbook, makeReport } from "../api/reports.js";

const contractId = "22222222-2222-4222-8222-222222222222";
const data = {
  properties: [{ id: "11111111-1111-4111-8111-111111111111", name: "Departamento Centro", type: "Departamento", address: "Av. Principal 100", rent: 25000, status: "Rentada" }],
  tenants: [{ id: "33333333-3333-4333-8333-333333333333", name: "Inquilina Prueba", email: "inquilina@example.com", phone: "" }],
  contracts: [{ id: contractId, property_id: "11111111-1111-4111-8111-111111111111", tenant_id: "33333333-3333-4333-8333-333333333333", start_date: "2026-07-01", end_date: "2027-06-30", rent: 25000, due_day: 5, status: "Vigente" }],
  payments: [{ id: "p1", contract_id: contractId, period: "2026-08", amount: 22000, payment_date: "2026-08-03", method: "Transferencia", notes: "" }],
  credits: [{ id: "c1", contract_id: contractId, amount: 1000, payment_date: "2026-08-10", note: "Anticipo" }]
};

const balances = makeReport(data, "balances", "2026-08", "");
assert.equal(balances.expected, 25000);
assert.equal(balances.paid, 22000);
assert.equal(balances.pending, 3000);

const statement = makeReport(data, "statement", "2026-08", contractId);
assert.equal(statement.totalCharges, 50000);
assert.equal(statement.totalPaid, 23000);
assert.equal(statement.balance, 27000);
assert.equal(statement.rows.at(-1).concept, "Anticipo");

const yolaData = {
  properties: [{ id: "p-yola", name: "PRUEBA NUBE", type: "Departamento", address: "", rent: 25000, status: "Rentada" }],
  tenants: [{ id: "t-yola", name: "Yola Pruea", email: "", phone: "" }],
  contracts: [{ id: "c-yola", property_id: "p-yola", tenant_id: "t-yola", start_date: new Date("2026-08-01T00:00:00.000Z"), end_date: new Date("2027-08-01T00:00:00.000Z"), rent: "25000.00", due_day: 5, status: "Vigente" }],
  payments: [{ id: "pay-yola", contract_id: "c-yola", period: "2026-08", amount: "12500.00", payment_date: new Date("2026-08-21T00:00:00.000Z"), method: "Efectivo", notes: "" }],
  credits: []
};
const yolaStatement = makeReport(yolaData, "statement", "2026-08", "c-yola");
assert.equal(yolaStatement.totalCharges, 25000);
assert.equal(yolaStatement.totalPaid, 12500);
assert.equal(yolaStatement.balance, 12500);

await mkdir("work/test-output", { recursive: true });
const xlsx = await buildWorkbook(statement);
await writeFile("work/test-output/estado-cuenta.xlsx", Buffer.from(xlsx));
const loaded = new ExcelJS.Workbook();
await loaded.xlsx.load(xlsx);
assert.equal(loaded.getWorksheet("Estado de cuenta").getCell("E5").value, 27000);

const pdf = await buildPdf(statement);
await writeFile("work/test-output/estado-cuenta.pdf", pdf);
assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
console.log("report generation ok");
