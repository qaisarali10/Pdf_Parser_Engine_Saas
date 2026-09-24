import { assertRequiredColumns, excelRowsFromBuffer, hasExcelExtension, normalizeRow } from "../utils/excel.js";
import { normalizeMonth, roundMoney, safeDecimal, safeNumber } from "../utils/numbers.js";

const SSR_COLUMNS = ["pafk", "sprice", "sqty", "sbonus", "salvalue", "clqty", "clbonus", "clvalue"];

function clean(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function makeAliasMap(aliases) {
  return new Map(aliases.map((alias) => [alias.paname, alias]));
}

async function loadAliasMap(store, user) {
  const aliases = await store.listAliases(user, { limit: 100000 });
  return makeAliasMap(aliases);
}

export async function validateSsrFile(file) {
  if (!file) return { ok: false, message: "No file uploaded." };
  if (!hasExcelExtension(file.originalname)) return { ok: false, message: "Only Excel files (.xlsx) are supported." };
  const rows = await excelRowsFromBuffer(file.buffer);
  const columns = assertRequiredColumns(rows, SSR_COLUMNS);
  if (!columns.ok) return { ok: false, message: columns.message };
  return { ok: true, rows };
}

export async function findMissingAliases({ store, rows, user }) {
  const aliasMap = await loadAliasMap(store, user);
  const missingAliases = [];

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    const paname = clean(row.pafk);
    if (paname && !aliasMap.has(paname)) {
      missingAliases.push(paname);
    }
  }

  return unique(missingAliases);
}

export function calculateSegregation({ row, scheme }) {
  const policybase = safeNumber(scheme.basepolicy);
  const policybonus = safeNumber(scheme.bonuspolicy);
  const policyprice = safeDecimal(scheme.tp);
  const divisor = policybase + policybonus || 1;

  const clbase = safeNumber(row.clqty);
  const clbonus = safeNumber(row.clbonus);
  const slbase = safeNumber(row.sqty);
  const slbonus = safeNumber(row.sbonus);

  const closeBaseFactor = ((clbase + clbonus) / divisor) * policybase;
  const closeBonusFactor = ((clbase + clbonus) / divisor) * policybonus;
  const saleBaseFactor = ((slbase + slbonus) / divisor) * policybase;
  const saleBonusFactor = ((slbase + slbonus) / divisor) * policybonus;

  return {
    clbase,
    clbonus,
    policybase,
    policybonus,
    policyprice,
    seg_base: roundMoney(closeBaseFactor * policyprice),
    seg_bonus: roundMoney(closeBonusFactor * policyprice),
    seg_bsunit: closeBaseFactor,
    seg_bnunit: closeBonusFactor,
    seg_slbase: roundMoney(saleBaseFactor * policyprice),
    seg_slbonus: roundMoney(saleBonusFactor * policyprice),
    seg_slbsunit: saleBaseFactor,
    seg_slbnunit: saleBonusFactor
  };
}

async function selectScheme({ store, product, ssrprice, row, schemeCache, user }) {
  if (!schemeCache.has(product.id)) {
    schemeCache.set(product.id, await store.getSchemesForProduct(user, product.id));
  }

  const schemes = schemeCache.get(product.id);
  let scheme = null;

  if (product.ptype === "Trade") {
    scheme = schemes[0] || null;
  } else {
    const exactMatches = schemes
      .filter((item) => Number(item.tp) === Number(ssrprice))
      .sort((a, b) => Number(b.schemeid) - Number(a.schemeid));
    scheme = exactMatches[0] || schemes[0] || null;
  }

  if (scheme) {
    return { scheme, temporary: false };
  }

  return { scheme: {
    id: null,
    productId: product.id,
    schemeid: 500,
    basepolicy: safeNumber(row.sqty),
    bonuspolicy: safeNumber(row.sbonus),
    tp: ssrprice
  }, temporary: true };
}

export async function checkSsrFile({ store, file, sessionKey = "default", user }) {
  const validation = await validateSsrFile(file);
  if (!validation.ok) return validation;

  const missingAliases = await findMissingAliases({ store, rows: validation.rows, user });
  await store.recordMissingAliases(user, sessionKey, missingAliases);

  return {
    ok: true,
    missingAliases,
    rowCount: validation.rows.length
  };
}

export async function processSsrUpload({ store, file, distributorId, month, year, sessionKey = "default", user }) {
  const selectedMonth = normalizeMonth(month);
  const selectedYear = Number(year) || new Date().getFullYear();

  if (!selectedMonth) return { ok: false, message: "Month must be selected." };
  if (!Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > 2100) {
    return { ok: false, message: "Year must be between 2000 and 2100." };
  }

  const validation = await validateSsrFile(file);
  if (!validation.ok) return validation;

  const distributor = await store.getDistributor(user, distributorId);
  if (!distributor) return { ok: false, message: "Invalid distributor selected." };

  if (await store.checkDistributorPeriodSales(user, distributorId, selectedMonth, selectedYear)) {
    return {
      ok: false,
      message: "This distributor already has data for the selected period.",
      rowCount: validation.rows.length
    };
  }

  const missingAliases = await findMissingAliases({ store, rows: validation.rows, user });
  if (missingAliases.length) {
    await store.recordMissingAliases(user, sessionKey, missingAliases);
    return {
      ok: true,
      status: "missing-aliases",
      missingAliases,
      inserted: 0,
      rowCount: validation.rows.length
    };
  }

  const aliasMap = await loadAliasMap(store, user);
  const schemeCache = new Map();
  const sales = [];
  let segBaseTotal = 0;

  for (const rawRow of validation.rows) {
    const row = normalizeRow(rawRow);
    const aliasName = clean(row.pafk);
    const productAlias = aliasMap.get(aliasName);

    if (!productAlias?.product) continue;

    const product = productAlias.product;
    const ssrprice = safeDecimal(row.sprice);
    const { scheme } = await selectScheme({ store, product, ssrprice, row, schemeCache, user });
    const values = calculateSegregation({ row, scheme });

    // Ownership is stamped by the store from its `user` argument; carrying the
    // whole user object in the row payload as well only invites it to be
    // written into a record verbatim.
    sales.push({
      distributorId,
      productId: product.id,
      alias: aliasName,
      sqty: safeNumber(row.sqty),
      sbonus: safeNumber(row.sbonus),
      sprice: ssrprice,
      salvalue: safeDecimal(row.salvalue),
      clqty: values.clbase,
      clbonus: values.clbonus,
      clvalue: safeDecimal(row.clvalue),
      pbase: values.policybase,
      pbonus: values.policybonus,
      tprice: values.policyprice,
      seg_base: values.seg_base,
      seg_bonus: values.seg_bonus,
      seg_bsunit: values.seg_bsunit,
      seg_bnunit: values.seg_bnunit,
      seg_slbase: values.seg_slbase,
      seg_slbonus: values.seg_slbonus,
      seg_slbsunit: values.seg_slbsunit,
      seg_slbnunit: values.seg_slbnunit,
      month: selectedMonth,
      year: selectedYear,
      date: new Date()
    });

    segBaseTotal += Number(values.seg_base || 0);
  }

  await store.createSales(user, sales);

  return {
    ok: true,
    status: "processed",
    inserted: sales.length,
    segBaseTotal: roundMoney(segBaseTotal),
    missingAliases: [],
    rowCount: validation.rows.length
  };
}
