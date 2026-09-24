import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { createApiRouter } from "./routes/api.js";
import { getAdminAuthService } from "./services/adminAuthService.js";
import { createStore } from "./store/index.js";
import { requestId } from "./middleware/requestId.js";
import { generalLimiter, strictLimiter, uploadLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { csrfProtection } from "./middleware/csrf.js";
import authRouter from "./routes/auth.js";

const store = await createStore();
const adminAuth = getAdminAuthService();

const app = express();
const distDir = path.resolve(env.rootDir, "dist");

if (env.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(compression());
app.use(cors({ 
  origin: env.clientOrigin, 
  credentials: true, 
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Session-Key", "X-Request-ID"]
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestId);
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.use("/api", generalLimiter);

app.use("/api/auth/login", strictLimiter);
app.use("/api/auth/reset-password", strictLimiter);
app.use("/api/auth/password/forgot", strictLimiter);
app.use("/api/auth/password/reset", strictLimiter);
app.use("/api/auth/oauth/session", strictLimiter);
for (const uploadPath of [
  "/api/imports/company-products",
  "/api/imports/product-aliases",
  "/api/imports/schemes",
  "/api/ssr/check",
  "/api/ssr/upload"
]) {
  app.use(uploadPath, uploadLimiter);
}

app.use("/api", csrfProtection);

app.use("/api/auth", authRouter);

app.use("/api", createApiRouter(store, adminAuth));

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "Not found" });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res, next) => {
    res.sendFile(path.join(distDir, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

// Registered last so it also catches failures from the static and SPA handlers.
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`SSR SaaS MERN server running on http://localhost:${env.port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${env.port} is already in use; stop the other process or set PORT.`);
  } else {
    console.error("Server failed to start", error);
  }
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down.`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
