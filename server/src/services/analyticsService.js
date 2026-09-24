import { supabaseAdmin } from "./supabaseClient.js";
import { buildUserFilter, getUserId, isAdmin } from "../utils/ownership.js";
import { decorateAuditLogs } from "./auditService.js";

function asNumber(value) {
  return Number(value || 0);
}

function text(value) {
  return String(value ?? "").trim();
}

function mapUpload(log) {
  return {
    id: text(log.id),
    kind: log.kind,
    filename: log.filename || "",
    status: log.status || "",
    rowCount: asNumber(log.row_count),
    created: asNumber(log.created),
    skipped: asNumber(log.skipped),
    inserted: asNumber(log.inserted),
    missingCount: asNumber(log.missing_count),
    createdAt: log.created_at
  };
}

function mapAudit(log) {
  return {
    id: text(log.id),
    user: log.user || "",
    // Resolved from the actor id by decorateAuditLogs, so the dashboard shows
    // a person rather than a uuid.
    userLabel: log.userLabel || "",
    userEmail: log.userEmail || "",
    action: log.action,
    resource: log.resource,
    resourceId: log.resource_id || "",
    status: log.status || "success",
    createdAt: log.created_at
  };
}

function mapMissing(doc) {
  return {
    id: text(doc.id),
    product: doc.product || "",
    sessionKey: doc.session_key || "default",
    createdAt: doc.created_at
  };
}

export async function buildDashboardAnalytics(user) {
  const db = supabaseAdmin();
  const userFilter = buildUserFilter(user);
  const admin = isAdmin(user);
  const rpcArgs = { p_user: getUserId(user), p_is_admin: admin };
  const auditFilter = admin ? {} : { user_id: text(getUserId(user)) };

  const count = async (table) => {
    const { count: total, error } = await db.from(table).select("id", { count: "exact", head: true }).match(userFilter);
    if (error) throw new Error(error.message);
    return total || 0;
  };

  const [
    totalCompanies,
    totalProducts,
    totalDistributors,
    totalSales,
    totalServices,
    totalUploads,
    monthlySalesResult,
    weeklySalesResult,
    topProductsResult,
    topDistributorsResult,
    uploadActivityResult,
    latestAuditLogsResult,
    latestUploadsResult,
    recentMissingAliasesResult
  ] = await Promise.all([
    count("companies"),
    count("products"),
    count("distributors"),
    count("sales"),
    count("services"),
    count("upload_logs"),
    db.rpc("sales_by_period", rpcArgs),
    db.rpc("sales_by_week", { ...rpcArgs, p_limit: 12 }),
    db.rpc("sales_by_product", rpcArgs),
    db.rpc("sales_by_distributor", rpcArgs),
    db.rpc("upload_activity_by_day", { ...rpcArgs, p_limit: 14 }),
    db.from("audit_logs").select("*").match(auditFilter).order("created_at", { ascending: false }).limit(8),
    db.from("upload_logs").select("*").match(userFilter).order("created_at", { ascending: false }).limit(8),
    db.from("temp_missing_products").select("*").match(userFilter).order("created_at", { ascending: false }).limit(8)
  ]);

  for (const result of [
    monthlySalesResult, weeklySalesResult, topProductsResult, topDistributorsResult,
    uploadActivityResult, latestAuditLogsResult, latestUploadsResult, recentMissingAliasesResult
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const monthRank = new Map(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i]));
  const monthlySales = [...monthlySalesResult.data]
    .sort((a, b) => (a.year - b.year) || ((monthRank.get(a.month) ?? -1) - (monthRank.get(b.month) ?? -1)))
    .slice(-12);
  const topProducts = [...topProductsResult.data].sort((a, b) => b.sales_value - a.sales_value).slice(0, 8);
  const topDistributors = [...topDistributorsResult.data].sort((a, b) => b.sales_value - a.sales_value).slice(0, 8);

  return {
    cards: {
      companies: totalCompanies,
      products: totalProducts,
      distributors: totalDistributors,
      sales: totalSales,
      services: totalServices,
      uploads: totalUploads
    },
    charts: {
      monthlySales: monthlySales.map((item) => ({
        label: `${String(item.month || "").toUpperCase()} ${item.year || ""}`.trim(),
        sales: asNumber(item.sales_value),
        rows: asNumber(item.rows)
      })),
      weeklySales: [...weeklySalesResult.data].reverse().map((item) => ({
        label: item.week ? new Date(item.week).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
        sales: asNumber(item.sales_value),
        rows: asNumber(item.rows)
      })),
      topProducts: topProducts.map((item) => ({ name: item.product_name || "Unknown product", sales: asNumber(item.sales_value), rows: asNumber(item.rows) })),
      topDistributors: topDistributors.map((item) => ({ name: item.distributor_name || "Unknown distributor", sales: asNumber(item.sales_value), rows: asNumber(item.rows) })),
      uploadActivity: [...uploadActivityResult.data].reverse().map((item) => ({
        label: item.day ? new Date(item.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
        uploads: asNumber(item.uploads),
        rows: asNumber(item.rows)
      }))
    },
    recent: {
      auditLogs: (await decorateAuditLogs(latestAuditLogsResult.data.map((row) => ({ ...row, user: row.user_id })))).map(mapAudit),
      uploads: latestUploadsResult.data.map(mapUpload),
      missingAliases: recentMissingAliasesResult.data.map(mapMissing)
    }
  };
}
