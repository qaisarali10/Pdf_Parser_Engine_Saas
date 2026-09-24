import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  skip: () => !env.isProduction,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." }
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  skip: () => !env.isProduction,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many authentication attempts, please try again later." }
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 upload requests per minute
  skip: () => !env.isProduction,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many upload attempts, please try again later." }
});

// Account lockout tracking
const loginAttempts = new Map();

function pruneExpiredAttempts(map, now = Date.now()) {
  for (const [key, value] of map) {
    if (now - value.firstAttempt > 15 * 60 * 1000) map.delete(key);
  }
  if (map.size > 10000) map.clear();
}

export function checkLoginRateLimit(req) {
  pruneExpiredAttempts(loginAttempts);
  const key = req.ip || "unknown";
  const attempts = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };

  // Reset after 15 minutes
  if (Date.now() - attempts.firstAttempt > 15 * 60 * 1000) {
    attempts.count = 0;
    attempts.firstAttempt = Date.now();
  }

  // Count every attempt from this IP, regardless of which username was
  // tried. Keying the count off "same username as last time" let an
  // attacker reset the counter on every request just by alternating
  // usernames, defeating brute-force protection entirely.
  attempts.count += 1;

  loginAttempts.set(key, attempts);

  // Block after 5 attempts in 15 minutes
  if (attempts.count > 5) {
    return false;
  }

  return true;
}

export function clearLoginAttempts(req) {
  const key = req.ip || "unknown";
  loginAttempts.delete(key);
}

// Password reset is throttled separately from login. Both the request and the
// consume step share this budget: the request step sends mail to an address the
// caller chose, and the consume step guesses a token, so both are worth
// limiting regardless of environment.
const passwordResetAttempts = new Map();

export function checkPasswordResetRateLimit(req, max = 10) {
  pruneExpiredAttempts(passwordResetAttempts);
  const key = req.ip || "unknown";
  const attempts = passwordResetAttempts.get(key) || { count: 0, firstAttempt: Date.now() };

  if (Date.now() - attempts.firstAttempt > 15 * 60 * 1000) {
    attempts.count = 0;
    attempts.firstAttempt = Date.now();
  }

  attempts.count += 1;
  passwordResetAttempts.set(key, attempts);

  return attempts.count <= max;
}
