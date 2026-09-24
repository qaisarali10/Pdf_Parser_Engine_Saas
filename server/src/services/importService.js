import { assertRequiredColumns, excelRowsFromBuffer, normalizeRow } from "../utils/excel.js";
import { safeDecimal, safeNumber } from "../utils/numbers.js";

function cell(row, key) {
  return String(row[key] || "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function key(value) {
  return String(value || "").trim().toLowerCase();
}

export async function importCompanyProducts({ store, file, companyId, ptype, user }) {
  const rows = await excelRowsFromBuffer(file.buffer);
  const columns = assertRequiredColumns(rows, ["product name"]);
  if (!columns.ok) return { ok: false, message: columns.message };

  const existing = await store.listProducts(user, { companyId, limit: 100000 });
  const existingNames = new Set(existing.map((product) => key(product.pname)));
  const names = unique(rows.map((row) => cell(normalizeRow(row), "product name")));
  let created = 0;
  let skipped = 0;

  for (const pname of names) {
    const productKey = key(pname);
    if (existingNames.has(productKey)) {
      skipped += 1;
      continue;
    }
    await store.createProduct(user, { companyId, pname, ptype });
    existingNames.add(productKey);
    created += 1;
  }

  return { ok: true, created, skipped, rowCount: rows.length };
}

export async function importProductAliases({ store, file, productId, user }) {
  const rows = await excelRowsFromBuffer(file.buffer);
  const columns = assertRequiredColumns(rows, ["product name"]);
  if (!columns.ok) return { ok: false, message: columns.message };

  const existing = await store.listAliases(user, { limit: 100000 });
  const existingNames = new Set(existing.map((alias) => key(alias.paname)));
  const names = unique(rows.map((row) => cell(normalizeRow(row), "product name")));

  let created = 0;
  let skipped = 0;

  for (const paname of names) {
    const aliasKey = key(paname);
    if (existingNames.has(aliasKey)) {
      skipped += 1;
      continue;
    }
    await store.createAlias(user, { productId, paname });
    existingNames.add(aliasKey);
    created += 1;
  }

  return { ok: true, created, skipped, rowCount: rows.length };
}

export async function importSchemes({ store, file, user }) {
  const rows = await excelRowsFromBuffer(file.buffer);
  const columns = assertRequiredColumns(rows, ["prd", "sch id", "bse", "bns", "tp"]);
  if (!columns.ok) return { ok: false, message: columns.message };

  const products = await store.listProducts(user, { limit: 100000 });
  const productByName = new Map(products.map((product) => [product.pname, product]));
  const schemes = [];
  const missingProducts = [];

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    const productName = cell(row, "prd");
    const product = productByName.get(productName);

    if (!product) {
      missingProducts.push(productName);
      continue;
    }

    schemes.push({
      productId: product.id,
      schemeid: safeNumber(row["sch id"]),
      basepolicy: safeNumber(row.bse),
      bonuspolicy: safeNumber(row.bns),
      tp: safeDecimal(row.tp)
    });
  }

  const created = await store.replaceSchemes(user, schemes);

  return {
    ok: true,
    created,
    missingProducts: unique(missingProducts),
    rowCount: rows.length
  };
}
