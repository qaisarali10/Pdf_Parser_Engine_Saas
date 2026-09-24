import JSZip from "jszip";
import { supabaseAdmin } from "./supabaseClient.js";
import { buildUserFilter, getUserId, isAdmin } from "../utils/ownership.js";

const reportTypes = new Set(["monthly-sales", "distributor", "product", "company", "audit"]);
const MONTH_RANK = new Map(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i]));

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  return Number(value || 0);
}

function csvValue(value) {
  const clean = text(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

function xml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function dateRange(filters) {
  const from = filters.from ? new Date(filters.from).toISOString() : null;
  let to = null;
  if (filters.to) {
    const end = new Date(filters.to);
    end.setHours(23, 59, 59, 999);
    to = end.toISOString();
  }
  return { from, to };
}

async function companyProductIds(db, user, companyId) {
  if (!companyId) return null;
  const query = { ...buildUserFilter(user), company_id: companyId };
  const { data, error } = await db.from("products").select("id").match(query);
  if (error) throw new Error(error.message);
  return data.map((row) => row.id);
}

async function companyDistributorIds(db, user, companyId) {
  if (!companyId) return null;
  const query = { ...buildUserFilter(user), company_id: companyId };
  const { data, error } = await db.from("distributors").select("id").match(query);
  if (error) throw new Error(error.message);
  return data.map((row) => row.id);
}

async function saleRpcArgs(db, user, filters) {
  const { from, to } = dateRange(filters);
  const args = {
    p_user: getUserId(user),
    p_is_admin: isAdmin(user),
    p_from: from,
    p_to: to,
    p_distributor_id: filters.distributorId || null,
    p_product_id: filters.productId || null,
    p_product_ids: null,
    p_distributor_ids: null
  };

  if (filters.companyId) {
    const [productIds, distributorIds] = await Promise.all([
      companyProductIds(db, user, filters.companyId),
      companyDistributorIds(db, user, filters.companyId)
    ]);
    args.p_product_ids = productIds;
    args.p_distributor_ids = distributorIds;
  }

  return args;
}

function definition(type) {
  const defs = {
    "monthly-sales": {
      title: "Monthly Sales Report",
      columns: [
        { key: "period", label: "Period" },
        { key: "rows", label: "Rows" },
        { key: "salesValue", label: "Sales Value" },
        { key: "closingValue", label: "Closing Value" }
      ]
    },
    distributor: {
      title: "Distributor Report",
      columns: [
        { key: "distributor", label: "Distributor" },
        { key: "company", label: "Company" },
        { key: "rows", label: "Rows" },
        { key: "salesValue", label: "Sales Value" },
        { key: "closingValue", label: "Closing Value" }
      ]
    },
    product: {
      title: "Product Report",
      columns: [
        { key: "product", label: "Product" },
        { key: "company", label: "Company" },
        { key: "rows", label: "Rows" },
        { key: "salesValue", label: "Sales Value" },
        { key: "closingValue", label: "Closing Value" }
      ]
    },
    company: {
      title: "Company Report",
      columns: [
        { key: "company", label: "Company" },
        { key: "products", label: "Products" },
        { key: "distributors", label: "Distributors" },
        { key: "rows", label: "Rows" },
        { key: "salesValue", label: "Sales Value" }
      ]
    },
    audit: {
      title: "Audit Report",
      columns: [
        { key: "createdAt", label: "Date" },
        { key: "user", label: "User" },
        { key: "action", label: "Action" },
        { key: "resource", label: "Resource" },
        { key: "status", label: "Status" }
      ]
    }
  };
  return defs[type] || defs["monthly-sales"];
}

export function normalizeReportType(type) {
  const clean = text(type);
  return reportTypes.has(clean) ? clean : "monthly-sales";
}

export async function generateReport(user, filters = {}) {
  const db = supabaseAdmin();
  const type = normalizeReportType(filters.type);
  const def = definition(type);
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  let rows = [];

  if (type === "audit") {
    let query = db.from("audit_logs").select("*");
    if (!isAdmin(user)) query = query.eq("user_id", text(getUserId(user)));
    const { from, to } = dateRange(filters);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);

    rows = data.map((row) => ({
      id: text(row.id),
      createdAt: row.created_at ? new Date(row.created_at).toLocaleString() : "",
      user: row.user_id || "",
      action: row.action || "",
      resource: row.resource_id ? `${row.resource} ${row.resource_id}` : row.resource,
      status: row.status || ""
    }));
    return { type, title: def.title, columns: def.columns, rows, total: rows.length };
  }

  const rpcArgs = await saleRpcArgs(db, user, filters);

  if (type === "monthly-sales") {
    const { data, error } = await db.rpc("sales_by_period", rpcArgs);
    if (error) throw new Error(error.message);
    rows = [...data]
      .sort((a, b) => (b.year - a.year) || ((MONTH_RANK.get(b.month) ?? -1) - (MONTH_RANK.get(a.month) ?? -1)))
      .slice(0, limit)
      .map((row) => ({
        id: `${row.month}-${row.year}`,
        period: `${text(row.month).toUpperCase()} ${row.year}`,
        rows: number(row.rows),
        salesValue: number(row.sales_value),
        closingValue: number(row.closing_value)
      }));
  }

  if (type === "distributor") {
    const { data, error } = await db.rpc("sales_by_distributor", rpcArgs);
    if (error) throw new Error(error.message);
    rows = [...data]
      .sort((a, b) => b.sales_value - a.sales_value)
      .slice(0, limit)
      .map((row) => ({
        id: row.distributor_id,
        distributor: row.distributor_name || "Unknown distributor",
        company: row.company_name || "",
        rows: number(row.rows),
        salesValue: number(row.sales_value),
        closingValue: number(row.closing_value)
      }));
  }

  if (type === "product") {
    const { data, error } = await db.rpc("sales_by_product", rpcArgs);
    if (error) throw new Error(error.message);
    rows = [...data]
      .sort((a, b) => b.sales_value - a.sales_value)
      .slice(0, limit)
      .map((row) => ({
        id: row.product_id,
        product: row.product_name || "Unknown product",
        company: row.company_name || "",
        rows: number(row.rows),
        salesValue: number(row.sales_value),
        closingValue: number(row.closing_value)
      }));
  }

  // One pass for the whole report rather than one query per company. Sales
  // are grouped by (product, distributor) once and then attributed in
  // memory: a sale counts once for a company reached through either side of
  // that pair, matching the old $or semantics.
  if (type === "company") {
    const scope = buildUserFilter(user);
    let companyQuery = db.from("companies").select("*").match(scope);
    if (filters.companyId) companyQuery = companyQuery.eq("id", filters.companyId);
    const { data: companies, error: companiesError } = await companyQuery.order("cname").limit(limit);
    if (companiesError) throw new Error(companiesError.message);

    if (!companies.length) {
      return { type, title: def.title, columns: def.columns, rows: [], total: 0 };
    }

    const companyIds = companies.map((company) => company.id);
    const { from, to } = dateRange(filters);
    const [{ data: products, error: productsError }, { data: distributors, error: distributorsError }, { data: grouped, error: groupedError }] = await Promise.all([
      db.from("products").select("id, company_id").match(scope).in("company_id", companyIds),
      db.from("distributors").select("id, company_id").match(scope).in("company_id", companyIds),
      db.rpc("sales_by_product_distributor_pair", {
        p_user: getUserId(user),
        p_is_admin: isAdmin(user),
        p_from: from,
        p_to: to,
        p_distributor_id: filters.distributorId || null,
        p_product_id: filters.productId || null
      })
    ]);
    if (productsError) throw new Error(productsError.message);
    if (distributorsError) throw new Error(distributorsError.message);
    if (groupedError) throw new Error(groupedError.message);

    const totals = new Map(companies.map((company) => [company.id, { products: 0, distributors: 0, rows: 0, salesValue: 0 }]));
    const productCompany = new Map();
    const distributorCompany = new Map();

    for (const product of products) {
      productCompany.set(product.id, product.company_id);
      const bucket = totals.get(product.company_id);
      if (bucket) bucket.products += 1;
    }
    for (const distributor of distributors) {
      distributorCompany.set(distributor.id, distributor.company_id);
      const bucket = totals.get(distributor.company_id);
      if (bucket) bucket.distributors += 1;
    }

    for (const group of grouped) {
      const owners = new Set([productCompany.get(group.product_id), distributorCompany.get(group.distributor_id)]);
      for (const owner of owners) {
        const bucket = owner && totals.get(owner);
        if (!bucket) continue;
        bucket.rows += number(group.rows);
        bucket.salesValue += number(group.sales_value);
      }
    }

    rows = companies.map((company) => {
      const bucket = totals.get(company.id);
      return {
        id: company.id,
        company: company.cname,
        products: bucket.products,
        distributors: bucket.distributors,
        rows: bucket.rows,
        salesValue: bucket.salesValue
      };
    });
  }

  return { type, title: def.title, columns: def.columns, rows, total: rows.length };
}

export function reportToCsv(report) {
  const header = report.columns.map((column) => csvValue(column.label)).join(",");
  const rows = report.rows.map((row) => report.columns.map((column) => csvValue(row[column.key])).join(","));
  return `${header}\n${rows.join("\n")}\n`;
}

export async function reportToExcel(report) {
  const zip = new JSZip();
  const tableRows = [report.columns.map((column) => column.label), ...report.rows.map((row) => report.columns.map((column) => row[column.key]))];
  const sheetRows = tableRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndexValue) => {
      const ref = `${columnName(columnIndexValue + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

export function reportToPdf(report) {
  const lines = [report.title, "", report.columns.map((column) => column.label).join(" | "), ...report.rows.map((row) => report.columns.map((column) => text(row[column.key])).join(" | "))];
  const content = lines.slice(0, 80).join("\\n").replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 10 Tf 40 780 Td 12 TL (${content}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += `${object}\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

export function reportFilename(report, format) {
  return `${report.type}-report.${format === "excel" ? "xlsx" : format}`;
}
