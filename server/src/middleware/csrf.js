import crypto from "node:crypto";
import { cookieSecure } from "../utils/cookies.js";
import { env } from "../config/env.js";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sessionId(req) {
  // Session key is the stable browser-provided identifier.
  // Do NOT include req.user because CSRF check runs BEFORE authentication
  // and including userId would make the token invalid after login.
  return String(req.headers["x-session-key"] || req.headers["x-session-id"] || req.ip || "default").slice(0, 128);
}

function signToken(key, nonce, createdAt) {
  return crypto
    .createHmac("sha256", env.adminTokenSecret)
    .update(`${key}:${nonce}:${createdAt}`)
    .digest("base64url");
}

function createToken(key) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const createdAt = Date.now();
  return `${nonce}.${createdAt}.${signToken(key, nonce, createdAt)}`;
}

function isValidToken(key, token) {
  const [nonce, createdAtText, signature] = String(token || "").split(".");
  const createdAt = Number(createdAtText);

  if (!key || !nonce || !createdAt || !signature) return false;
  // Reject malformed timestamps, expired tokens, and timestamps from the
  // future. This keeps validation deterministic even if a malformed token is
  // supplied and avoids treating it as valid indefinitely.
  if (!Number.isSafeInteger(createdAt) || createdAt > Date.now() || Date.now() - createdAt > TOKEN_TTL_MS) return false;

  const expected = signToken(key, nonce, createdAt);
  const tokenBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return tokenBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function csrfProtection(req, res, next) {
  // Skip safe methods and the token endpoint itself
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path === "/csrf-token") {
    return next();
  }

  const token = req.headers["x-csrf-token"];
  const key = sessionId(req);

  if (!isValidToken(key, token)) {
    return res.status(403).json({ message: "Invalid CSRF token." });
  }

  next();
}

export function generateCsrfToken(req, res) {
  const key = sessionId(req);
  const token = createToken(key);
  
  // Set cookie with token for convenience - MUST have path "/" so it is
  // sent on every request, not just /api/csrf-token
  res.cookie("x-csrf-token", token, {
    httpOnly: false, // Must be accessible to JavaScript
    secure: cookieSecure(req),
    sameSite: "strict",
    path: "/",
    maxAge: TOKEN_TTL_MS // 12 hours
  });
  
  res.json({ csrfToken: token });
}

export function clearCsrfToken(req, res) {
  res.clearCookie("x-csrf-token", { path: "/", httpOnly: false, sameSite: "strict", secure: cookieSecure(req) });
  res.status(204).end();
}
