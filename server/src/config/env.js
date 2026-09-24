import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function requiredProductionSecret(name, fallback) {
  const value = process.env[name] || fallback;
  const unsafeDefaults = new Set([
    "admin123",
    "admin-reset-123",
    "change-this-local-secret",
    "change-this-admin-password-32chars",
    "change-this-recovery-code-32chars"
  ]);
  if (isProduction && (!process.env[name] || value.length < 16 || unsafeDefaults.has(value))) {
    throw new Error(`${name} must be set to at least 16 characters in production.`);
  }
  return value;
}

function requiredProductionSetting(name, fallback) {
  if (isProduction && !process.env[name]) throw new Error(`${name} must be set in production.`);
  return process.env[name] || fallback;
}

export const env = {
  rootDir,
  nodeEnv,
  isProduction,
  port: integer("PORT", 5050, { max: 65535 }),
  supabaseUrl: requiredProductionSetting("SUPABASE_URL", ""),
  supabaseAnonKey: requiredProductionSetting("SUPABASE_ANON_KEY", ""),
  supabaseServiceRoleKey: requiredProductionSecret("SUPABASE_SERVICE_ROLE_KEY", ""),
  clientOrigin: requiredProductionSetting("CLIENT_ORIGIN", "http://localhost:5180"),
  adminUsername: requiredProductionSetting("ADMIN_USERNAME", "admin"),
  adminPassword: requiredProductionSecret("ADMIN_PASSWORD", "admin123"),
  adminRecoveryCode: requiredProductionSecret("ADMIN_RECOVERY_CODE", "admin-reset-123"),
  adminTokenSecret: requiredProductionSecret("ADMIN_TOKEN_SECRET", "change-this-local-secret"),
  adminAuthStatePath: path.resolve(rootDir, process.env.ADMIN_AUTH_STATE_PATH || "server/.data/admin-auth.json"),
  trustProxy: process.env.TRUST_PROXY === "true",
  maxUploadBytes: integer("MAX_UPLOAD_BYTES", 10 * 1024 * 1024, { max: 25 * 1024 * 1024 }),
  maxSpreadsheetRows: integer("MAX_SPREADSHEET_ROWS", 50000, { max: 200000 }),
  // Where Supabase's confirmation/reset-link emails point back to (the
  // `emailRedirectTo`/`redirectTo` options). Defaults to the browser origin
  // the API already trusts, so a correct CLIENT_ORIGIN is enough for most
  // deployments. Must also be added to the Supabase project's Redirect URLs.
  appUrl: process.env.APP_URL || requiredProductionSetting("CLIENT_ORIGIN", "http://localhost:5180")
};
