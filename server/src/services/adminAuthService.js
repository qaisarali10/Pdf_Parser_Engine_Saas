import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env as appEnv } from "../config/env.js";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function loadState(statePath, username) {
  try {
    if (!fs.existsSync(statePath)) return null;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (state.username !== username || !state.salt || !state.passwordHash) return null;
    return state;
  } catch (error) {
    console.warn(`Could not read admin auth state: ${error.message}`);
    return null;
  }
}

// Cheap change detector, so the common case costs one stat() rather than a
// read and a JSON parse.
function stateStamp(statePath) {
  try {
    const stats = fs.statSync(statePath);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "";
  }
}

export function createAdminAuthService(env) {
  let state = loadState(env.adminAuthStatePath, env.adminUsername);
  let stamp = stateStamp(env.adminAuthStatePath);

  /**
   * The stored credential is shared state, not per-instance state: the state
   * file on disk is the source of truth, and it can change under a running
   * instance. Re-reading it whenever it changes keeps every holder agreeing on
   * the current password and token version -- across the several services a
   * single process builds, and across workers if the app is run with more than
   * one. Caching it in a closure meant a reset advanced the version in the
   * instance that handled the request only: the cookie it then issued carried a
   * version the /api router had never heard of, so signing in appeared to work
   * and every screen answered 401.
   */
  function current() {
    const latest = stateStamp(env.adminAuthStatePath);
    if (latest !== stamp) {
      stamp = latest;
      state = loadState(env.adminAuthStatePath, env.adminUsername);
    }
    return state;
  }

  function verifyCredentials(username, password) {
    if (!safeEqual(username, env.adminUsername)) return false;
    const active = current();
    if (!active) {
      // Fallback to env password only if no state file exists
      return safeEqual(password, env.adminPassword);
    }
    // Verify password against stored hash
    return safeEqual(passwordHash(password, active.salt), active.passwordHash);
  }

  function verifyRecovery(username, recoveryCode) {
    return Boolean(env.adminRecoveryCode)
      && safeEqual(username, env.adminUsername)
      && safeEqual(recoveryCode, env.adminRecoveryCode);
  }

  function resetPassword(newPassword) {
    const salt = crypto.randomBytes(16).toString("hex");
    const next = {
      username: env.adminUsername,
      salt,
      passwordHash: passwordHash(newPassword, salt),
      tokenVersion: Number(current()?.tokenVersion || 0) + 1,
      updatedAt: new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(env.adminAuthStatePath), { recursive: true });
    fs.writeFileSync(env.adminAuthStatePath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    state = next;
    stamp = stateStamp(env.adminAuthStatePath);
    return next.tokenVersion;
  }

  return {
    get recoveryEnabled() {
      return Boolean(env.adminRecoveryCode);
    },
    get tokenVersion() {
      return Number(current()?.tokenVersion || 0);
    },
    verifyCredentials,
    verifyRecovery,
    resetPassword
  };
}

let shared = null;

/**
 * The instance the application runs on. Routers must take this rather than
 * building their own, so that issuing a cookie and checking it are done
 * against the same token version.
 */
export function getAdminAuthService() {
  if (!shared) shared = createAdminAuthService(appEnv);
  return shared;
}
