const SESSION_KEY = "ssr-saas-session-key";
const CSRF_COOKIE = "x-csrf-token";
const UNREACHABLE = "Cannot reach the application server. Make sure the API is running, then try again.";

let csrfPromise = null;
let csrfToken = null;

function clearAuth() {
  sessionStorage.removeItem("ssr-saas-auth-user");
  csrfToken = null;
  csrfPromise = null;
}

function getSessionKey() {
  let key = localStorage.getItem(SESSION_KEY);
  if (!key) {
    // Use crypto.randomUUID if available, otherwise use a more secure fallback
    key = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${crypto.getRandomValues(new Uint8Array(16)).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '')}`;
    localStorage.setItem(SESSION_KEY, key);
  }
  return key;
}

function readCsrfCookie() {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

/**
 * Fetch (and cache) a fresh CSRF token from the server before the first
 * mutating request. The server stores the token in the x-csrf-token cookie
 * scoped to "/" and signs it against the stable x-session-key header, so we
 * only need to call this once per session unless the token expires.
 */
async function ensureCsrfToken({ forceRefresh = false } = {}) {
  // Prefer an already-known token.
  if (!forceRefresh && csrfToken) return csrfToken;

  // Otherwise read the cookie the server may already have set.
  const cookieToken = forceRefresh ? null : readCsrfCookie();
  if (!forceRefresh && cookieToken) {
    csrfToken = cookieToken;
    return csrfToken;
  }

  // Avoid racing concurrent calls with a shared promise.
  if (!csrfPromise) {
    csrfPromise = fetch("/api/csrf-token", {
      method: "GET",
      credentials: "include",
      headers: { "x-session-key": getSessionKey() }
    })
      .then(async (response) => {
        // A token request that fails outright usually means the API process is
        // not up yet, so report that rather than an opaque CSRF failure.
        if (!response.ok) {
          throw new Error(response.status >= 500 ? UNREACHABLE : "Could not obtain a security token. Please reload the page.");
        }
        const payload = await response.json();
        csrfToken = payload.csrfToken || readCsrfCookie();
        if (!csrfToken) {
          throw new Error("Could not obtain a security token. Please reload the page.");
        }
        return csrfToken;
      })
      .catch((error) => {
        throw error instanceof TypeError ? new Error(UNREACHABLE) : error;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

function isCsrfMessage(message) {
  return /\bcsrf\b/i.test(String(message || ""));
}

async function responseHasCsrfError(response) {
  if (response.status !== 403) return false;

  try {
    const payload = await response.clone().json();
    return isCsrfMessage(payload.message || payload.detail);
  } catch {
    try {
      return isCsrfMessage(await response.clone().text());
    } catch {
      return false;
    }
  }
}

/**
 * Make an API request with the session identifier and, for state-changing
 * methods, a CSRF token. A stale token is transparently replaced once. Keep
 * this at the fetch layer so JSON endpoints and file downloads behave alike.
 */
async function csrfFetch(url, options = {}, retried = false) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "x-session-key": getSessionKey(),
    ...(options.headers || {})
  };

  const isMutating = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (isMutating) {
    const token = await ensureCsrfToken({ forceRefresh: retried });
    headers["x-csrf-token"] = token;
  }

  const init = { credentials: "include", ...options, method: options.method || "GET", headers };

  if (init.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.body);
  }

  const response = await fetch(url, init);

  // Tokens expire while a tab is open. Refresh and retry once before exposing
  // the error, including for multipart/file-download requests.
  if (await responseHasCsrfError(response)) {
    csrfToken = null;
    csrfPromise = null;
    if (!retried) return csrfFetch(url, options, true);
  }

  return response;
}

const STATUS_MESSAGES = {
  400: "The request was rejected. Please check the values and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to complete this action.",
  404: "That resource could not be found.",
  409: "That record already exists.",
  413: "That file is too large to upload.",
  429: "Too many attempts. Please wait a moment and try again.",
  502: UNREACHABLE,
  503: UNREACHABLE,
  504: "The server took too long to respond. Please try again."
};

/**
 * Turn a failed response into something a person can act on. A body that is
 * not JSON means the request died before it reached the API (dev proxy down,
 * gateway error), so it is reported as an unreachable server rather than as
 * the raw HTTP status text like "Internal Server Error".
 */
function describeFailure(status, parsedMessage, bodyWasJson) {
  if (parsedMessage) return parsedMessage;
  if (!bodyWasJson && status >= 500) return UNREACHABLE;
  return STATUS_MESSAGES[status] || "Something went wrong. Please try again.";
}

async function request(path, options = {}) {
  let response;
  try {
    response = await csrfFetch(`/api${path}`, options);
  } catch (networkError) {
    const error = new Error(UNREACHABLE);
    error.status = 0;
    error.cause = networkError;
    throw error;
  }

  if (!response.ok) {
    let parsedMessage = "";
    let bodyWasJson = false;
    try {
      const payload = await response.json();
      bodyWasJson = true;
      parsedMessage = payload.message || payload.detail || "";
    } catch {
      bodyWasJson = false;
    }
    const message = describeFailure(response.status, parsedMessage, bodyWasJson);
    if (response.status === 401) clearAuth();
    if (response.status === 403 && isCsrfMessage(message)) {
      csrfToken = null;
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  // Handle 204 No Content responses gracefully.
  if (response.status === 204) return undefined;

  return response.json();
}

// Firefox only honours a programmatic click on a link that is in the document,
// and revoking the object URL on the same tick can cancel the transfer before
// it starts, so the handle is released once the browser has taken it.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function makeForm(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value !== undefined && value !== null) form.append(key, value);
  }
  if (file) form.append("file", file);
  return form;
}

export const api = {
  // A 401 here means "not signed in" and must stay a 401. An earlier version
  // fell back to synthesising an { role: "admin" } user from /stats, which
  // would hand the whole workspace to an anonymous visitor the moment /stats
  // stopped requiring a session.
  me: () => request("/auth/me"),
  logout: async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch {
      // Logout should succeed even if a token expired or CSRF already cleared.
    }
    clearAuth();
  },
  login: async (body, { remember = false } = {}) => {
    const result = await request("/auth/login", { method: "POST", body: { ...body, remember } });
    return result;
  },
  register: (body) => request("/auth/register", { method: "POST", body }),
  // Administrator recovery, using ADMIN_RECOVERY_CODE.
  resetPassword: (body) => request("/auth/reset-password", { method: "POST", body }),
  // Self-service reset for registered users: request a link, then spend it.
  forgotPassword: (body) => request("/auth/password/forgot", { method: "POST", body }),
  resetPasswordWithToken: (body) => request("/auth/password/reset", { method: "POST", body }),
  // Spends the confirmation link Supabase emails after signup.
  confirmEmail: (body) => request("/auth/confirm", { method: "POST", body }),
  resendConfirmation: (body) => request("/auth/resend-confirmation", { method: "POST", body }),
  // Hands an OAuth (Google, ...) session the browser got directly from
  // Supabase over to the server, which adopts it into our own cookies.
  oauthSession: (body) => request("/auth/oauth/session", { method: "POST", body }),
  // Administrator user management.
  users: (params = {}) => request(`/users?${new URLSearchParams(params)}`),
  setUserPassword: (id, newPassword) => request(`/users/${id}/password`, { method: "POST", body: { newPassword } }),
  stats: () => request("/stats"),
  dashboardAnalytics: () => request("/analytics/dashboard"),
  fileActivity: (params = {}) => request(`/file-activity?${new URLSearchParams(params)}`),
  auditLogs: (params = {}) => request(`/audit?${new URLSearchParams(params)}`),
  reports: (params = {}) => request(`/reports?${new URLSearchParams(params)}`),
  downloadReport: async (params = {}) => {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/reports/export?${query}`, {
      method: "GET",
      credentials: "include",
      headers: { "x-session-key": getSessionKey() }
    });
    if (response.status === 401) clearAuth();
    if (!response.ok) throw new Error("Could not download report.");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `report.${params.format || "csv"}`;
    saveBlob(blob, filename);
  },
  companies: () => request("/companies"),
  createCompany: (body) => request("/companies", { method: "POST", body }),
  distributors: (params = {}) => request(`/distributors?${new URLSearchParams(params)}`),
  createDistributor: (body) => request("/distributors", { method: "POST", body }),
  products: (params = {}) => request(`/products?${new URLSearchParams(params)}`),
  createProduct: (body) => request("/products", { method: "POST", body }),
  aliases: (params = {}) => request(`/aliases?${new URLSearchParams(params)}`),
  createAlias: (body) => request("/aliases", { method: "POST", body }),
  schemes: (params = {}) => request(`/schemes?${new URLSearchParams(params)}`),
  services: (params = {}) => request(`/services?${new URLSearchParams(params)}`),
  createService: (body) => request("/services", { method: "POST", body }),
  sales: (params = {}) => request(`/sales?${new URLSearchParams(params)}`),
  missingAliases: () => request("/missing-aliases"),
  addMissingAlias: (body) => request("/missing-aliases", { method: "POST", body }),
  latestSummaryPeriod: () => request("/summary/latest-period"),
  summaryPeriods: () => request("/summary/periods"),
  summary: (month, year) => request(`/summary/${month}/${year}`),
  uploadSsr: ({ file, distributorId, month, year }) =>
    request("/ssr/upload", { method: "POST", body: makeForm({ distributorId, month, year }, file) }),
  checkSsr: ({ file }) => request("/ssr/check", { method: "POST", body: makeForm({}, file) }),
  importCompanyProducts: ({ file, companyId, ptype }) =>
    request("/imports/company-products", { method: "POST", body: makeForm({ companyId, ptype }, file) }),
  importProductAliases: ({ file, productId }) =>
    request("/imports/product-aliases", { method: "POST", body: makeForm({ productId }, file) }),
  importSchemes: ({ file }) => request("/imports/schemes", { method: "POST", body: makeForm({}, file) }),
  downloadMissingAliases: async ({ file }) => {
    const response = await csrfFetch("/api/ssr/check?download=1", {
      method: "POST",
      body: makeForm({}, file)
    });
    if (response.status === 401) clearAuth();
    if (!response.ok) throw new Error("Could not download missing aliases.");
    const blob = await response.blob();
    saveBlob(blob, "missing_aliases.xlsx");
  },
  updateProfile: (body) => request("/auth/profile", { method: "PUT", body }),
  changePassword: (body) => request("/auth/profile/password", { method: "PUT", body }),
  deleteAccount: () => request("/auth/profile", { method: "DELETE" })
};
