import { supabaseAdmin, supabaseConfigured } from "./supabaseClient.js";

function text(value) {
  return String(value ?? "").trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Audit rows record who acted as an id string, which is not something a
 * person can recognise. Resolve a whole page of them to names and addresses
 * in one pass rather than showing a uuid in the interface.
 *
 * The built-in administrator is recorded under its username instead of an
 * id, so it never resolves here and is labelled from the id itself.
 */
export async function decorateAuditLogs(logs) {
  const ids = new Set(logs.map((log) => text(log.user)).filter(isUuid));

  let actors = new Map();
  if (ids.size) {
    const [{ data: authUsers }, { data: profiles }] = await Promise.all([
      supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabaseAdmin().from("profiles").select("id, name").in("id", [...ids])
    ]);
    const nameById = new Map((profiles || []).map((profile) => [profile.id, profile.name]));
    actors = new Map(
      (authUsers?.users || [])
        .filter((user) => ids.has(user.id))
        .map((user) => [user.id, { email: user.email, name: nameById.get(user.id) || "" }])
    );
  }

  return logs.map((log) => {
    const id = text(log.user);
    const actor = actors.get(id);
    const email = actor?.email || text(log.metadata?.email);
    const name = actor?.name || text(log.metadata?.name);

    let label = name || email;
    if (!label && id && !isUuid(id)) label = id === "admin" ? "Administrator" : id;

    return { ...log, userLabel: label, userEmail: email };
  });
}

function userId(user) {
  return text(user?._id || user?.id || user?.username || user);
}

// Role is the only admissible signal. Matching on a username meant that if a
// `username` field were ever added to profiles, anyone who registered as
// "admin" would be handed every tenant's audit trail.
function isAdmin(user) {
  return user?.role === "admin";
}

function cleanMetadata(metadata = {}) {
  const blocked = new Set(["password", "currentPassword", "newPassword", "confirmPassword", "token", "tokenHash", "accessToken", "refreshToken"]);
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => !blocked.has(key))
  );
}

function mapAuditLog(log) {
  return {
    id: text(log.id),
    user: log.user_id || "",
    userLabel: log.userLabel || "",
    userEmail: log.userEmail || "",
    action: log.action,
    resource: log.resource,
    resourceId: log.resource_id || "",
    metadata: log.metadata || {},
    ipAddress: log.ip_address || "",
    userAgent: log.user_agent || "",
    status: log.status || "success",
    createdAt: log.created_at
  };
}

export async function logAudit({
  req,
  user,
  action,
  resource,
  resourceId = "",
  metadata = {},
  status = "success"
}) {
  if (!supabaseConfigured()) {
    req?.log?.warn?.({ action, resource }, "Audit log skipped because Supabase is not connected");
    return;
  }

  try {
    const actor = user || req?.user || {};
    const { error } = await supabaseAdmin().from("audit_logs").insert({
      user_id: userId(actor),
      action: text(action),
      resource: text(resource),
      resource_id: text(resourceId),
      metadata: cleanMetadata(metadata),
      ip_address: text(req?.ip || req?.socket?.remoteAddress),
      user_agent: text(req?.headers?.["user-agent"]),
      status: status === "failure" ? "failure" : "success"
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    req?.log?.warn?.({ error: error.message }, "Audit log write failed");
  }
}

export async function listAuditLogs(currentUser, filters = {}) {
  const page = Math.max(Number(filters.page) || 1, 1);
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);

  if (!supabaseConfigured()) {
    return { page, limit, total: 0, pages: 1, logs: [] };
  }

  let query = supabaseAdmin().from("audit_logs").select("*", { count: "exact" });

  if (!isAdmin(currentUser)) query = query.eq("user_id", userId(currentUser));
  if (filters.action) query = query.eq("action", text(filters.action));
  if (filters.user && isAdmin(currentUser)) query = query.eq("user_id", text(filters.user));

  if (filters.from) query = query.gte("created_at", new Date(filters.from).toISOString());
  if (filters.to) query = query.lte("created_at", new Date(filters.to).toISOString());

  if (filters.search) {
    const needle = text(filters.search).replace(/[%_\\]/g, (char) => `\\${char}`);
    const pattern = `%${needle}%`;
    query = query.or(
      `action.ilike.${pattern},resource.ilike.${pattern},resource_id.ilike.${pattern},user_id.ilike.${pattern}`
    );
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);

  const total = count || 0;
  return {
    page,
    limit,
    total,
    pages: Math.max(Math.ceil(total / limit), 1),
    logs: (await decorateAuditLogs(data.map((row) => ({ ...row, user: row.user_id })))).map(mapAuditLog)
  };
}
