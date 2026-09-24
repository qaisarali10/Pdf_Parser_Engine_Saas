import { supabaseAdmin } from "../services/supabaseClient.js";
import { buildMonthlySummary } from "../services/summaryService.js";
import { buildUserFilter, getUserId, isAdmin, verifyOwnership } from "../utils/ownership.js";

const DISTRIBUTOR_JOIN = "*, company:companies(*)";
const PRODUCT_JOIN = "*, company:companies(*)";
const ALIAS_JOIN = "*, product:products(*, company:companies(*))";
const SCHEME_JOIN = "*, product:products(*, company:companies(*))";
const SALE_JOIN = "*, distributor:distributors(*, company:companies(*)), product:products(*, company:companies(*))";

function text(value) {
  return String(value || "").trim();
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Escapes ILIKE's wildcard characters so a search term is matched literally.
function escapeLike(value) {
  return text(value).replace(/[%_\\]/g, (char) => `\\${char}`);
}

function contains(value) {
  return `%${escapeLike(value)}%`;
}

function raise(error) {
  if (error) throw new Error(error.message || "Supabase request failed");
}

function mapCompany(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    cname: row.cname
  };
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    companyId: row.company_id,
    company: row.company ? mapCompany(row.company) : null,
    pname: row.pname,
    ptype: row.ptype
  };
}

function mapDistributor(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    companyId: row.company_id,
    company: row.company ? mapCompany(row.company) : null,
    did: row.did,
    dname: row.dname,
    area: row.area || "",
    subarea: row.subarea || "",
    cell: row.cell || "",
    status: row.status !== false
  };
}

function mapAlias(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    productId: row.product_id,
    product: row.product ? mapProduct(row.product) : null,
    paname: row.paname
  };
}

function mapScheme(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    productId: row.product_id,
    product: row.product ? mapProduct(row.product) : null,
    schemeid: row.schemeid,
    basepolicy: row.basepolicy,
    bonuspolicy: row.bonuspolicy,
    tp: row.tp
  };
}

function mapSale(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyId: row.legacy_id ?? null,
    distributorId: row.distributor_id,
    distributor: row.distributor ? mapDistributor(row.distributor) : null,
    productId: row.product_id,
    product: row.product ? mapProduct(row.product) : null,
    alias: row.alias,
    sqty: num(row.sqty),
    sbonus: num(row.sbonus),
    sprice: num(row.sprice),
    salvalue: num(row.salvalue),
    clqty: num(row.clqty),
    clbonus: num(row.clbonus),
    clvalue: num(row.clvalue),
    pbase: num(row.pbase),
    pbonus: num(row.pbonus),
    tprice: num(row.tprice),
    seg_base: num(row.seg_base),
    seg_bonus: num(row.seg_bonus),
    seg_bsunit: num(row.seg_bsunit),
    seg_bnunit: num(row.seg_bnunit),
    seg_slbase: num(row.seg_slbase),
    seg_slbonus: num(row.seg_slbonus),
    seg_slbsunit: num(row.seg_slbsunit),
    seg_slbnunit: num(row.seg_slbnunit),
    month: row.month,
    year: row.year,
    date: row.date
  };
}

function mapUploadLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename || "",
    status: row.status || "",
    rowCount: row.row_count || 0,
    created: row.created || 0,
    skipped: row.skipped || 0,
    inserted: row.inserted || 0,
    missingCount: row.missing_count || 0,
    sessionKey: row.session_key || "default",
    createdAt: row.created_at
  };
}

function mapService(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category || "Other",
    description: row.description || "",
    price: row.price || 0,
    status: row.status !== false,
    createdAt: row.created_at
  };
}

export class SupabaseStore {
  constructor() {
    this.mode = "supabase";
    this.db = supabaseAdmin();
  }

  async stats(user) {
    const filter = buildUserFilter(user);
    const count = async (table) => {
      let query = this.db.from(table).select("id", { count: "exact", head: true }).match(filter);
      const { count: total, error } = await query;
      raise(error);
      return total || 0;
    };

    const [companies, distributors, products, aliases, schemes, sales, services, missingAliases, files] = await Promise.all([
      count("companies"),
      count("distributors"),
      count("products"),
      count("product_aliases"),
      count("product_schemes"),
      count("sales"),
      count("services"),
      count("temp_missing_products"),
      count("upload_logs")
    ]);

    return { mode: this.mode, companies, distributors, products, aliases, schemes, sales, services, missingAliases, files };
  }

  async listCompanies(user) {
    const { data, error } = await this.db.from("companies").select("*").match(buildUserFilter(user)).order("cname");
    raise(error);
    return data.map(mapCompany);
  }

  async createCompany(user, { cname }) {
    const { data, error } = await this.db
      .from("companies")
      .insert({ user_id: getUserId(user), cname: text(cname) })
      .select()
      .single();
    raise(error);
    return mapCompany(data);
  }

  async listDistributors(user, { companyId, q, activeOnly = false, limit = 600 } = {}) {
    let query = this.db.from("distributors").select(DISTRIBUTOR_JOIN).match(buildUserFilter(user));
    if (companyId) query = query.eq("company_id", companyId);
    if (activeOnly) query = query.eq("status", true);
    if (q) query = query.or(`dname.ilike.${contains(q)},area.ilike.${contains(q)}`);
    const { data, error } = await query.order("dname").limit(Number(limit) || 600);
    raise(error);
    return data.map(mapDistributor);
  }

  async getDistributor(user, id) {
    const { data, error } = await this.db.from("distributors").select(DISTRIBUTOR_JOIN).eq("id", id).maybeSingle();
    raise(error);
    if (!verifyOwnership(user, data)) return null;
    return mapDistributor(data);
  }

  async createDistributor(user, payload) {
    const { data, error } = await this.db
      .from("distributors")
      .insert({
        user_id: getUserId(user),
        company_id: payload.companyId || null,
        did: Number(payload.did) || 1,
        dname: text(payload.dname),
        area: text(payload.area),
        subarea: text(payload.subarea),
        cell: text(payload.cell),
        status: payload.status !== false
      })
      .select(DISTRIBUTOR_JOIN)
      .single();
    raise(error);
    return mapDistributor(data);
  }

  async listProducts(user, { companyId, q, ptype, limit = 600 } = {}) {
    let query = this.db.from("products").select(PRODUCT_JOIN).match(buildUserFilter(user));
    if (companyId) query = query.eq("company_id", companyId);
    if (ptype) query = query.eq("ptype", ptype);
    if (q) query = query.ilike("pname", contains(q));
    const { data, error } = await query.order("pname").limit(Number(limit) || 600);
    raise(error);
    return data.map(mapProduct);
  }

  async getProduct(user, id) {
    const { data, error } = await this.db.from("products").select(PRODUCT_JOIN).eq("id", id).maybeSingle();
    raise(error);
    if (!verifyOwnership(user, data)) return null;
    return mapProduct(data);
  }

  async createProduct(user, payload) {
    const { data, error } = await this.db
      .from("products")
      .insert({
        user_id: getUserId(user),
        company_id: payload.companyId || null,
        pname: text(payload.pname),
        ptype: payload.ptype === "Trade" ? "Trade" : "Retail"
      })
      .select(PRODUCT_JOIN)
      .single();
    raise(error);
    return mapProduct(data);
  }

  async listAliases(user, { productId, q, limit = 600 } = {}) {
    let query = this.db.from("product_aliases").select(ALIAS_JOIN).match(buildUserFilter(user));
    if (productId) query = query.eq("product_id", productId);
    if (q) query = query.ilike("paname", contains(q));
    const { data, error } = await query.order("paname").limit(Number(limit) || 600);
    raise(error);
    return data.map(mapAlias);
  }

  // Alias names are unique per tenant, not globally, so the owner filter must
  // stay -- without it one tenant registering "ABC-500" would block every
  // other tenant from doing the same.
  async aliasExists(user, paname) {
    const { count, error } = await this.db
      .from("product_aliases")
      .select("id", { count: "exact", head: true })
      .match(buildUserFilter(user))
      .ilike("paname", escapeLike(paname));
    raise(error);
    return Boolean(count);
  }

  async getAliasByName(user, paname) {
    const { data, error } = await this.db
      .from("product_aliases")
      .select(ALIAS_JOIN)
      .match(buildUserFilter(user))
      .ilike("paname", escapeLike(paname))
      .maybeSingle();
    raise(error);
    return mapAlias(data);
  }

  async createAlias(user, { productId, paname }) {
    const { data, error } = await this.db
      .from("product_aliases")
      .insert({ user_id: getUserId(user), product_id: productId, paname: text(paname) })
      .select(ALIAS_JOIN)
      .single();
    raise(error);
    return mapAlias(data);
  }

  async listSchemes(user, { productId, q, limit = 700 } = {}) {
    let query = this.db.from("product_schemes").select(SCHEME_JOIN).match(buildUserFilter(user));
    if (productId) query = query.eq("product_id", productId);
    const { data, error } = await query.order("schemeid", { ascending: false }).limit(Number(limit) || 700);
    raise(error);

    let rows = data;
    if (q) {
      const needle = text(q).toLowerCase();
      rows = rows.filter((row) => text(row.schemeid).includes(needle) || text(row.product?.pname).toLowerCase().includes(needle));
    }
    return rows.map(mapScheme);
  }

  async getSchemesForProduct(user, productId) {
    const { data, error } = await this.db
      .from("product_schemes")
      .select(SCHEME_JOIN)
      .match(buildUserFilter(user))
      .eq("product_id", productId)
      .order("schemeid", { ascending: false });
    raise(error);
    return data.map(mapScheme);
  }

  async createScheme(user, payload) {
    const { data, error } = await this.db
      .from("product_schemes")
      .insert({
        user_id: getUserId(user),
        product_id: payload.productId,
        schemeid: Number(payload.schemeid) || 0,
        basepolicy: Number(payload.basepolicy) || 0,
        bonuspolicy: Number(payload.bonuspolicy) || 0,
        tp: Number(payload.tp) || 0
      })
      .select(SCHEME_JOIN)
      .single();
    raise(error);
    return mapScheme(data);
  }

  async deleteScheme(user, id) {
    const { data, error } = await this.db.from("product_schemes").select("id, user_id").eq("id", id).maybeSingle();
    raise(error);
    if (!verifyOwnership(user, data)) return false;

    const { error: deleteError } = await this.db.from("product_schemes").delete().eq("id", id);
    raise(deleteError);
    return true;
  }

  async replaceSchemes(user, schemes) {
    const payload = schemes.map((scheme) => ({
      productId: scheme.productId,
      schemeid: Number(scheme.schemeid) || 0,
      basepolicy: Number(scheme.basepolicy) || 0,
      bonuspolicy: Number(scheme.bonuspolicy) || 0,
      tp: Number(scheme.tp) || 0
    }));
    const { error } = await this.db.rpc("replace_schemes", { p_user: getUserId(user), p_schemes: payload });
    raise(error);
    return schemes.length;
  }

  async checkRecentDistributorSales(user, distributorId, daysBack = 6) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const start = new Date(today);
    start.setDate(start.getDate() - daysBack);
    start.setHours(0, 0, 0, 0);

    const { count, error } = await this.db
      .from("sales")
      .select("id", { count: "exact", head: true })
      .match(buildUserFilter(user))
      .eq("distributor_id", distributorId)
      .gte("date", start.toISOString())
      .lte("date", today.toISOString());
    raise(error);
    return Boolean(count);
  }

  async checkDistributorPeriodSales(user, distributorId, month, year) {
    const { count, error } = await this.db
      .from("sales")
      .select("id", { count: "exact", head: true })
      .match(buildUserFilter(user))
      .eq("distributor_id", distributorId)
      .eq("month", month)
      .eq("year", Number(year));
    raise(error);
    return Boolean(count);
  }

  async createSale(user, payload) {
    const { data, error } = await this.db
      .from("sales")
      .insert(saleRow(user, payload))
      .select(SALE_JOIN)
      .single();
    raise(error);
    return mapSale(data);
  }

  async createSales(user, payloads) {
    if (!payloads.length) return [];
    // One RPC call, one Postgres transaction: the whole batch is all-or-
    // nothing, same guarantee MongoStore got from session.withTransaction().
    // Unlike a BSON document, a jsonb parameter has no 16MB ceiling, so the
    // batch does not need to be chunked the way Mongo's insertMany did.
    const { data, error } = await this.db.rpc("insert_sales_batch", {
      p_user: getUserId(user),
      p_sales: payloads.map((payload) => saleRpcItem(payload))
    });
    raise(error);
    return (data || []).map(mapSale);
  }

  async listSales(user, { month, year, distributorId, limit = 250 } = {}) {
    const parsedLimit = Number(limit) || 250;
    let query = this.db.from("sales").select(parsedLimit <= 5000 ? SALE_JOIN : "*").match(buildUserFilter(user));
    if (month) query = query.eq("month", month);
    if (year) query = query.eq("year", Number(year));
    if (distributorId) query = query.eq("distributor_id", distributorId);
    const { data, error } = await query.order("date", { ascending: false }).limit(parsedLimit);
    raise(error);
    return data.map(mapSale);
  }

  async listServices(user, { q, activeOnly = false, limit = 600 } = {}) {
    let query = this.db.from("services").select("*").match(buildUserFilter(user));
    if (activeOnly) query = query.eq("status", true);
    if (q) query = query.or(`name.ilike.${contains(q)},category.ilike.${contains(q)}`);
    const { data, error } = await query.order("name").limit(Number(limit) || 600);
    raise(error);
    return data.map(mapService);
  }

  async createService(user, payload) {
    const { data, error } = await this.db
      .from("services")
      .insert({
        user_id: getUserId(user),
        name: text(payload.name),
        category: text(payload.category) || "Other",
        description: text(payload.description),
        price: Number(payload.price) || 0,
        status: payload.status !== false
      })
      .select()
      .single();
    raise(error);
    return mapService(data);
  }

  async monthlySummary(user, { month, year }) {
    let query = this.db.from("sales").select(SALE_JOIN).match(buildUserFilter(user)).eq("year", Number(year));
    if (month !== "all") query = query.eq("month", month);
    const { data, error } = await query;
    raise(error);
    return buildMonthlySummary({ sales: data.map(mapSale), month, year: Number(year) });
  }

  async latestSalesPeriod(user) {
    const { data, error } = await this.db.rpc("latest_sales_period", { p_user: getUserId(user), p_is_admin: isAdmin(user) });
    raise(error);
    const [latest] = data || [];
    if (!latest) return null;
    return { month: latest.month, year: Number(latest.year) };
  }

  async summaryPeriods(user) {
    const { data, error } = await this.db.rpc("summary_periods", { p_user: getUserId(user), p_is_admin: isAdmin(user) });
    raise(error);
    return (data || []).map((row) => ({ month: row.month, year: Number(row.year), count: Number(row.count) }));
  }

  async recordMissingAliases(user, sessionKey, aliases) {
    const owner = getUserId(user);
    const { error: deleteError } = await this.db
      .from("temp_missing_products")
      .delete()
      .match({ user_id: owner, session_key: sessionKey });
    raise(deleteError);

    if (!aliases.length) return;
    const { error } = await this.db
      .from("temp_missing_products")
      .insert(aliases.map((alias) => ({ user_id: owner, product: text(alias), session_key: sessionKey })));
    raise(error);
  }

  async listMissingAliases(user, { sessionKey } = {}) {
    let query = this.db.from("temp_missing_products").select("*").match(buildUserFilter(user));
    if (sessionKey) query = query.eq("session_key", sessionKey);
    const { data, error } = await query.order("product");
    raise(error);
    return data.map((row) => ({ id: row.id, product: row.product, sessionKey: row.session_key, createdAt: row.created_at }));
  }

  async resolveMissingAlias(user, sessionKey, product) {
    const { error } = await this.db
      .from("temp_missing_products")
      .delete()
      .match({ user_id: getUserId(user), session_key: sessionKey, product: text(product) });
    raise(error);
  }

  async recordFileActivity(user, payload) {
    const { data, error } = await this.db
      .from("upload_logs")
      .insert({
        user_id: getUserId(user),
        kind: text(payload.kind),
        filename: text(payload.filename),
        status: text(payload.status || "processed"),
        row_count: Number(payload.rowCount) || 0,
        created: Number(payload.created) || 0,
        skipped: Number(payload.skipped) || 0,
        inserted: Number(payload.inserted) || 0,
        missing_count: Number(payload.missingCount) || 0,
        session_key: text(payload.sessionKey || "default")
      })
      .select()
      .single();
    raise(error);
    return mapUploadLog(data);
  }

  async listFileActivity(user, { limit = 12 } = {}) {
    const { data, error } = await this.db
      .from("upload_logs")
      .select("*")
      .match(buildUserFilter(user))
      .order("created_at", { ascending: false })
      .limit(Number(limit) || 12);
    raise(error);
    return data.map(mapUploadLog);
  }
}

function saleRow(user, payload) {
  return {
    user_id: getUserId(user),
    distributor_id: payload.distributorId,
    product_id: payload.productId,
    alias: payload.alias,
    sqty: payload.sqty,
    sbonus: payload.sbonus,
    sprice: payload.sprice,
    salvalue: payload.salvalue,
    clqty: payload.clqty,
    clbonus: payload.clbonus,
    clvalue: payload.clvalue,
    pbase: payload.pbase,
    pbonus: payload.pbonus,
    tprice: payload.tprice,
    seg_base: payload.seg_base,
    seg_bonus: payload.seg_bonus,
    seg_bsunit: payload.seg_bsunit,
    seg_bnunit: payload.seg_bnunit,
    seg_slbase: payload.seg_slbase,
    seg_slbonus: payload.seg_slbonus,
    seg_slbsunit: payload.seg_slbsunit,
    seg_slbnunit: payload.seg_slbnunit,
    month: payload.month,
    year: payload.year,
    date: payload.date ? new Date(payload.date).toISOString() : new Date().toISOString()
  };
}

function saleRpcItem(payload) {
  return {
    distributorId: payload.distributorId,
    productId: payload.productId,
    alias: payload.alias,
    sqty: payload.sqty,
    sbonus: payload.sbonus,
    sprice: payload.sprice,
    salvalue: payload.salvalue,
    clqty: payload.clqty,
    clbonus: payload.clbonus,
    clvalue: payload.clvalue,
    pbase: payload.pbase,
    pbonus: payload.pbonus,
    tprice: payload.tprice,
    seg_base: payload.seg_base,
    seg_bonus: payload.seg_bonus,
    seg_bsunit: payload.seg_bsunit,
    seg_bnunit: payload.seg_bnunit,
    seg_slbase: payload.seg_slbase,
    seg_slbonus: payload.seg_slbonus,
    seg_slbsunit: payload.seg_slbsunit,
    seg_slbnunit: payload.seg_slbnunit,
    month: payload.month,
    year: payload.year,
    date: payload.date ? new Date(payload.date).toISOString() : new Date().toISOString()
  };
}
