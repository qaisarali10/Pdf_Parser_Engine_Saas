import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { env } from "../config/env.js";
import { importCompanyProducts, importProductAliases, importSchemes } from "../services/importService.js";
import { checkSsrFile, processSsrUpload } from "../services/ssrService.js";
import { hasExcelExtension, missingAliasesWorkbook } from "../utils/excel.js";
import { normalizeMonth } from "../utils/numbers.js";
import { schemas, validate } from "../middleware/validation.js";
import { generateCsrfToken } from "../middleware/csrf.js";
import { createAuthService } from "../services/authService.js";
import { verifyAccessToken } from "../middleware/auth.js";
import { validateFileUpload } from "../middleware/fileValidation.js";
import { listAuditLogs, logAudit } from "../services/auditService.js";
import { buildDashboardAnalytics } from "../services/analyticsService.js";
import { generateReport, reportFilename, reportToCsv, reportToExcel, reportToPdf } from "../services/reportingService.js";
import { supabaseConfigured } from "../services/supabaseClient.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, hasExcelExtension(file.originalname));
  }
});

function cappedLimit(value, fallback, max) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sessionKey(req) {
  return String(req.headers["x-session-key"] || req.ip || "default").slice(0, 128);
}

function ensureExcel(req, res) {
  if (!req.file) {
    res.status(400).json({ message: "No file uploaded." });
    return false;
  }
  if (!hasExcelExtension(req.file.originalname)) {
    res.status(400).json({ message: "Only Excel files (.xlsx) are supported." });
    return false;
  }
  return true;
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

function validId(store, value) {
  if (!value) return false;
  return store.mode === "supabase" ? UUID_RE.test(String(value)) : /^\d+$/.test(String(value));
}

function sign(payload) {
  return crypto
    .createHmac("sha256", env.adminTokenSecret)
    .update(payload)
    .digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const authService = createAuthService();

function cookie(req, name) {
  const match = String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name);
  return match ? decodeURIComponent(match.slice(1).join("=")) : "";
}

function verifyAdminToken(token, tokenVersion) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub === env.adminUsername
      && Number(data.ver) === Number(tokenVersion || 0)
      && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function requireAuthenticated(adminAuth) {
  return asyncRoute(async (req, res, next) => {
    const accessToken = cookie(req, "accessToken");

    if (accessToken) {
      const user = await verifyAccessToken(accessToken);
      if (user) {
        req.user = user;
        req.authType = "user";
        return next();
      }
    }

    const header = String(req.headers.authorization || "");
    const adminToken = cookie(req, "ssr_admin") || (header.startsWith("Bearer ") ? header.slice(7) : "");
    if (verifyAdminToken(adminToken, adminAuth.tokenVersion)) {
      req.user = {
        _id: env.adminUsername,
        name: "Administrator",
        email: "",
        role: "admin",
        username: env.adminUsername
      };
      req.admin = true;
      req.authType = "admin";
      return next();
    }

    return res.status(401).json({ message: "Authentication required" });
  });
}

async function recordFileActivity(store, req, kind, result, user) {
  await store.recordFileActivity?.(user, {
    kind,
    filename: String(req.file?.originalname || "").slice(0, 240),
    status: result.status || (result.ok ? "processed" : "failed"),
    rowCount: result.rowCount,
    created: result.created,
    skipped: result.skipped,
    inserted: result.inserted,
    missingCount: result.missingAliases?.length || result.missingProducts?.length || 0,
    sessionKey: sessionKey(req)
  });
}

async function audit(req, action, resource, resourceId, metadata = {}, status = "success") {
  await logAudit({ req, user: req.user, action, resource, resourceId, metadata, status });
}

export function createApiRouter(store, adminAuth) {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true, mode: store.mode, time: new Date().toISOString() });
  });

  router.get("/ready", (_req, res) => {
    const ready = store.mode === "supabase" && supabaseConfigured();
    res.status(ready ? 200 : 503).json({ ok: ready, mode: store.mode });
  });

  router.get("/csrf-token", (req, res) => {
    generateCsrfToken(req, res);
  });

  router.use(requireAuthenticated(adminAuth));

  // --- Administrator user management --------------------------------------
  // The way someone who cannot receive mail gets back in. Admin-only, and the
  // built-in admin cookie counts as an admin here.
  const adminOnly = (req, res, next) => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Administrator access is required." });
    }
    return next();
  };

  router.get("/users", adminOnly, asyncRoute(async (req, res) => {
    const users = await authService.listUsers({ q: req.query.q, limit: req.query.limit });
    res.json(users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: Boolean(user.isVerified),
      lastLogin: user.lastLogin || null,
      createdAt: user.createdAt
    })));
  }));

  router.post("/users/:id/password", adminOnly, validate(schemas.adminSetPassword), asyncRoute(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return badRequest(res, "Invalid user selected.");

    const user = await authService.setPassword(req.params.id, req.body.newPassword);
    if (!user) return res.status(404).json({ message: "User not found." });

    await audit(req, "admin_password_set", "user", String(user._id), { email: user.email });
    // setPassword stamps passwordChangedAt, so the user's existing sessions
    // are already void by the time this responds.
    res.json({ message: `Password updated for ${user.email}. Their existing sessions have been signed out.` });
  }));

  router.get("/stats", asyncRoute(async (req, res) => {
    res.json(await store.stats(req.user));
  }));

  router.get("/analytics/dashboard", asyncRoute(async (req, res) => {
    res.json(await buildDashboardAnalytics(req.user, store));
  }));

  router.get("/file-activity", asyncRoute(async (req, res) => {
    res.json(await store.listFileActivity(req.user, { limit: cappedLimit(req.query.limit, 12, 100) }));
  }));

  router.get("/audit", asyncRoute(async (req, res) => {
    res.json(await listAuditLogs(req.user, req.query));
  }));

  router.get("/reports", asyncRoute(async (req, res) => {
    res.json(await generateReport(req.user, req.query));
  }));

  router.get("/reports/export", asyncRoute(async (req, res) => {
    const format = String(req.query.format || "csv").toLowerCase();
    const report = await generateReport(req.user, { ...req.query, limit: 1000 });

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(report, "pdf")}"`);
      return res.send(reportToPdf(report));
    }

    if (format === "excel") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(report, "excel")}"`);
      return res.send(await reportToExcel(report));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(report, "csv")}"`);
    return res.send(reportToCsv(report));
  }));

  router.get("/companies", asyncRoute(async (req, res) => {
    res.json(await store.listCompanies(req.user));
  }));

  router.post("/companies", validate(schemas.createCompany), asyncRoute(async (req, res) => {
    const created = await store.createCompany(req.user, { cname: req.body.cname });
    await audit(req, "create", "company", created.id, { name: created.cname });
    res.status(201).json(created);
  }));

  router.get("/distributors", asyncRoute(async (req, res) => {
    res.json(await store.listDistributors(req.user, { ...req.query, limit: cappedLimit(req.query.limit, 600, 1000) }));
  }));

  router.post("/distributors", validate(schemas.createDistributor), asyncRoute(async (req, res) => {
    if (req.body.companyId && !validId(store, req.body.companyId)) return badRequest(res, "Invalid company selected.");
    const created = await store.createDistributor(req.user, req.body);
    await audit(req, "create", "distributor", created.id, { name: created.dname, companyId: created.companyId });
    res.status(201).json(created);
  }));

  router.get("/products", asyncRoute(async (req, res) => {
    res.json(await store.listProducts(req.user, { ...req.query, limit: cappedLimit(req.query.limit, 600, 1000) }));
  }));

  router.post("/products", validate(schemas.createProduct), asyncRoute(async (req, res) => {
    if (req.body.companyId && !validId(store, req.body.companyId)) return badRequest(res, "Invalid company selected.");
    const created = await store.createProduct(req.user, req.body);
    await audit(req, "create", "product", created.id, { name: created.pname, companyId: created.companyId, ptype: created.ptype });
    res.status(201).json(created);
  }));

  router.get("/aliases", asyncRoute(async (req, res) => {
    res.json(await store.listAliases(req.user, { ...req.query, limit: cappedLimit(req.query.limit, 600, 1000) }));
  }));

  router.post("/aliases", validate(schemas.createAlias), asyncRoute(async (req, res) => {
    if (await store.aliasExists(req.user, req.body.paname)) {
      return res.status(409).json({ message: "This alias product already exists." });
    }
    const created = await store.createAlias(req.user, req.body);
    await audit(req, "create", "alias", created.id, { name: created.paname, productId: created.productId });
    res.status(201).json(created);
  }));

  router.get("/schemes", asyncRoute(async (req, res) => {
    res.json(await store.listSchemes(req.user, { ...req.query, limit: cappedLimit(req.query.limit, 700, 1000) }));
  }));

  router.get("/services", asyncRoute(async (req, res) => {
    res.json(await store.listServices(req.user, { ...req.query, limit: cappedLimit(req.query.limit, 600, 1000) }));
  }));

  router.post("/services", validate(schemas.createService), asyncRoute(async (req, res) => {
    const created = await store.createService(req.user, req.body);
    await audit(req, "create", "service", created.id, { name: created.name, category: created.category });
    res.status(201).json(created);
  }));

  router.post("/imports/company-products", upload.single("file"), validateFileUpload, validate(schemas.importCompanyProducts), asyncRoute(async (req, res) => {
    const result = await importCompanyProducts({
      store,
      file: req.file,
      companyId: req.body.companyId,
      ptype: req.body.ptype,
      user: req.user
    });

    await recordFileActivity(store, req, "products", result, req.user);
    await audit(req, "import", "company_products", "", { filename: req.file?.originalname, companyId: req.body.companyId, ptype: req.body.ptype, ...result }, result.ok ? "success" : "failure");
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.post("/imports/product-aliases", upload.single("file"), validateFileUpload, validate(schemas.importProductAliases), asyncRoute(async (req, res) => {
    const result = await importProductAliases({
      store,
      file: req.file,
      productId: req.body.productId,
      user: req.user
    });

    await recordFileActivity(store, req, "aliases", result, req.user);
    await audit(req, "import", "product_aliases", "", { filename: req.file?.originalname, productId: req.body.productId, ...result }, result.ok ? "success" : "failure");
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.post("/imports/schemes", upload.single("file"), validateFileUpload, asyncRoute(async (req, res) => {
    if (!ensureExcel(req, res)) return;

    const result = await importSchemes({
      store,
      file: req.file,
      user: req.user
    });

    await recordFileActivity(store, req, "schemes", result, req.user);
    await audit(req, "import", "schemes", "", { filename: req.file?.originalname, ...result }, result.ok ? "success" : "failure");
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.post("/ssr/check", upload.single("file"), validateFileUpload, asyncRoute(async (req, res) => {
    const result = await checkSsrFile({ 
      store, 
      file: req.file, 
      sessionKey: sessionKey(req),
      user: req.user
    });
    if (!result.ok) return res.status(400).json(result);

    if (req.query.download !== "1") {
      await recordFileActivity(store, req, "check", result, req.user);
      await audit(req, "ssr_check", "ssr", "", { filename: req.file?.originalname, ...result }, result.ok ? "success" : "failure");
    }

    if (req.query.download === "1") {
      const workbook = await missingAliasesWorkbook(result.missingAliases);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=\"missing_aliases.xlsx\"");
      return res.send(workbook);
    }

    res.json(result);
  }));

  router.post("/ssr/upload", upload.single("file"), validateFileUpload, validate(schemas.ssrUpload), asyncRoute(async (req, res) => {
    const result = await processSsrUpload({
      store,
      file: req.file,
      distributorId: req.body.distributorId,
      month: req.body.month,
      year: req.body.year,
      sessionKey: sessionKey(req),
      user: req.user
    });

    await recordFileActivity(store, req, "ssr", result, req.user);
    await audit(req, "ssr_upload", "ssr", "", { filename: req.file?.originalname, distributorId: req.body.distributorId, month: req.body.month, year: req.body.year, ...result }, result.ok ? "success" : "failure");
    res.status(result.ok ? 200 : 400).json(result);
  }));

  router.get("/missing-aliases", asyncRoute(async (req, res) => {
    res.json(await store.listMissingAliases(req.user, { sessionKey: req.query.all === "1" ? undefined : sessionKey(req) }));
  }));

  router.post("/missing-aliases", validate(schemas.createMissingAlias), asyncRoute(async (req, res) => {
    const { productId, missing } = req.body;
    
    if (!(await store.getProduct(req.user, productId))) return badRequest(res, "Invalid product selected.");
    if (await store.aliasExists(req.user, missing)) return res.status(409).json({ message: "This alias product already exists." });

    const alias = await store.createAlias(req.user, { productId, paname: missing });
    await store.resolveMissingAlias?.(req.user, sessionKey(req), missing);
    await audit(req, "create", "missing_alias", alias.id, { productId, missing });
    res.status(201).json(alias);
  }));

  router.get("/summary/latest-period", asyncRoute(async (req, res) => {
    res.json(await store.latestSalesPeriod?.(req.user) || { month: null, year: null });
  }));

  router.get("/summary/periods", asyncRoute(async (req, res) => {
    res.json(await store.summaryPeriods?.(req.user) || []);
  }));

  router.get("/summary/:month/:year", asyncRoute(async (req, res) => {
    const requestedMonth = String(req.params.month || "").trim().toLowerCase();
    const month = requestedMonth === "all" ? "all" : normalizeMonth(requestedMonth);
    const year = Number(req.params.year);
    if (!month) return badRequest(res, "A valid month is required.");
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return badRequest(res, "Year must be between 2000 and 2100.");
    }
    res.json(await store.monthlySummary(req.user, { month, year }));
  }));

  router.get("/sales", asyncRoute(async (req, res) => {
    const month = req.query.month ? normalizeMonth(req.query.month) : undefined;
    if (req.query.month && !month) return badRequest(res, "Invalid month selected.");

    res.json(await store.listSales(req.user, {
      month,
      year: req.query.year,
      distributorId: req.query.distributorId,
      limit: cappedLimit(req.query.limit, 250, 1000)
    }));
  }));

  // Only the upload-specific failures are translated here. Everything else is
  // handed to the application error handler so one request cannot get a
  // differently shaped 500 depending on which router caught it.
  router.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  });

  return router;
}
