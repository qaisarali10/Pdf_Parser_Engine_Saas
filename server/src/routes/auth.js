import { Router } from "express";
import crypto from "node:crypto";
import { createAuthService } from "../services/authService.js";
import { getAdminAuthService } from "../services/adminAuthService.js";
import { authenticateUser, verifyAccessToken } from "../middleware/auth.js";
import { schemas, validate } from "../middleware/validation.js";
import { createLogger } from "../services/logger.js";
import { env } from "../config/env.js";
import { cookieSecure } from "../utils/cookies.js";
import { logAudit } from "../services/auditService.js";
import { checkLoginRateLimit, checkPasswordResetRateLimit, clearLoginAttempts } from "../middleware/rateLimiter.js";

const logger = createLogger({ module: "authRoutes" });
const authService = createAuthService();
const adminAuth = getAdminAuthService();

const router = Router();

function isDuplicateEmailError(error) {
  return error?.message === "Email already registered";
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload) {
  return crypto
    .createHmac("sha256", env.adminTokenSecret)
    .update(payload)
    .digest("base64url");
}

function createAdminToken(tokenVersion) {
  const payload = base64Url(JSON.stringify({
    sub: env.adminUsername,
    ver: Number(tokenVersion || 0),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  }));
  return `${payload}.${sign(payload)}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// Signing in as the built-in administrator sets only the ssr_admin cookie, so
// a Supabase-only check reports that live session as signed out and the
// workspace bounces back to the login page on the next page load. The /api
// routes accept both cookies; this lets /auth/me agree with them.
async function authenticateUserOrAdmin(req, res, next) {
  const token = req.cookies?.accessToken;

  if (token) {
    const user = await verifyAccessToken(token);
    if (user) {
      req.user = user;
      return next();
    }
  }

  if (verifyAdminToken(req.cookies?.ssr_admin, adminAuth.tokenVersion)) {
    req.user = {
      _id: env.adminUsername,
      username: env.adminUsername,
      name: "Administrator",
      email: "",
      role: "admin"
    };
    req.admin = true;
    return next();
  }

  return authenticateUser(req, res, next);
}

function setSessionCookies(req, res, tokens) {
  const base = { httpOnly: true, secure: cookieSecure(req), sameSite: "strict" };
  res.cookie("accessToken", tokens.accessToken, { ...base, maxAge: (tokens.expiresIn || 3600) * 1000 });
  res.cookie("refreshToken", tokens.refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearSessionCookies(req, res) {
  const cookieOptions = { httpOnly: true, secure: cookieSecure(req), sameSite: "strict", path: "/" };
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);
}

function setAdminAuthCookie(req, res, token, remember = false) {
  const parts = [
    `ssr_admin=${encodeURIComponent(token)}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
    ...(cookieSecure(req) ? ["Secure"] : []),
    ...(remember ? [`Max-Age=${60 * 60 * 12}`] : [])
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

router.post("/register", validate(schemas.register), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const { user, tokens, needsConfirmation } = await authService.register({ name, email, password });
    await logAudit({ req, user, action: "signup", resource: "user", resourceId: user._id, metadata: { name, email } });

    logger.info({ userId: user._id, email }, "User registered successfully");

    if (needsConfirmation) {
      // No session until the confirmation link is used, so there is nothing
      // to log this browser into yet -- the client shows a "check your
      // email" screen instead of entering the workspace.
      return res.status(201).json({
        message: "Check your email to confirm your account before signing in.",
        needsConfirmation: true,
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
      });
    }

    setSessionCookies(req, res, tokens);
    return res.status(201).json({
      message: "Registration successful",
      needsConfirmation: false,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    logger.error({ error: error.message }, "Registration failed");

    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: "This email is already registered. Please sign in instead." });
    }

    return res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/login", validate(schemas.login), async (req, res) => {
  try {
    const { username, password, remember } = req.body;

    if (!checkLoginRateLimit(req)) {
      return res.status(429).json({ message: "Too many login attempts. Please try again in 15 minutes." });
    }

    if (adminAuth.verifyCredentials(username, password)) {
      clearLoginAttempts(req);
      setAdminAuthCookie(req, res, createAdminToken(adminAuth.tokenVersion), remember);
      await logAudit({ req, user: { _id: env.adminUsername, role: "admin" }, action: "login", resource: "auth", resourceId: env.adminUsername, metadata: { username, admin: true } });
      logger.info({ username: env.adminUsername }, "Admin logged in successfully");
      return res.json({
        message: "Login successful",
        user: { username: env.adminUsername, name: "Administrator", role: "admin" }
      });
    }

    const { user, tokens } = await authService.login({ username, password });
    clearLoginAttempts(req);
    await logAudit({ req, user, action: "login", resource: "auth", resourceId: user._id, metadata: { email: user.email } });

    setSessionCookies(req, res, tokens);

    logger.info({ userId: user._id, email: user.email }, "User logged in successfully");

    return res.json({
      message: "Login successful",
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    logger.warn({ error: error.message }, "Login failed");
    if (/email not confirmed/i.test(error.message)) {
      return res.status(403).json({ message: error.message, needsConfirmation: true });
    }
    return res.status(401).json({ message: "Invalid username or password" });
  }
});

router.post("/reset-password", validate(schemas.resetPassword), async (req, res) => {
  const { username, recoveryCode, newPassword } = req.body;

  if (!adminAuth.recoveryEnabled) {
    return res.status(503).json({ message: "Password recovery is not configured. Set ADMIN_RECOVERY_CODE to enable it." });
  }

  // One generic failure for a wrong username and a wrong code alike, so the
  // response cannot be used to discover which administrator names exist.
  if (!adminAuth.verifyRecovery(username, recoveryCode)) {
    await logAudit({ req, user: { _id: username, role: "admin" }, action: "password_reset", resource: "auth", resourceId: username, status: "failure" });
    logger.warn({ username }, "Administrator recovery attempt rejected");
    return res.status(401).json({ message: "Invalid username or recovery code." });
  }

  let tokenVersion;
  try {
    tokenVersion = adminAuth.resetPassword(newPassword);
  } catch (error) {
    logger.error({ error: error.message }, "Could not persist administrator password");
    return res.status(500).json({ message: "Could not save the new password. Please try again." });
  }

  // resetPassword bumps the stored token version, so every cookie issued
  // before this point stops verifying. Drop this browser's copy as well.
  res.clearCookie("ssr_admin", { httpOnly: true, sameSite: "strict", secure: cookieSecure(req), path: "/api" });

  await logAudit({ req, user: { _id: env.adminUsername, role: "admin" }, action: "password_reset", resource: "auth", resourceId: env.adminUsername, metadata: { tokenVersion } });
  logger.info({ username: env.adminUsername, tokenVersion }, "Administrator password reset");

  return res.json({ message: "Password updated. Please sign in with your new password." });
});

// Self-service reset, step 1: ask for a link. Supabase sends the email and
// answers the same way whether or not the address has an account, so this
// stays a generic response regardless of what happened underneath.
router.post("/password/forgot", validate(schemas.forgotPassword), async (req, res) => {
  const { email } = req.body;
  const generic = { message: "If that address has an account, a reset link is on its way." };

  if (!checkPasswordResetRateLimit(req)) {
    return res.status(429).json({ message: "Too many reset requests. Please try again in 15 minutes." });
  }

  try {
    await authService.requestPasswordReset(email);
    logger.info({ email }, "Password reset link requested");
    return res.json(generic);
  } catch (error) {
    logger.error({ error: error.message }, "Password reset request failed");
    return res.status(500).json({ message: "Could not start a password reset. Please try again." });
  }
});

// Self-service reset, step 2: spend the link's token_hash.
router.post("/password/reset", validate(schemas.resetPasswordWithToken), async (req, res) => {
  const { tokenHash, newPassword } = req.body;

  if (!checkPasswordResetRateLimit(req)) {
    return res.status(429).json({ message: "Too many reset attempts. Please try again in 15 minutes." });
  }

  try {
    const { user, tokens } = await authService.resetPassword(tokenHash, newPassword);

    await logAudit({ req, user, action: "password_reset", resource: "user", resourceId: user._id, metadata: { email: user.email } });

    // The reset link itself just authenticated this browser, so sign it in
    // with the fresh session rather than bouncing back to the login form.
    setSessionCookies(req, res, tokens);

    logger.info({ userId: user._id }, "Password reset completed");
    return res.json({ message: "Password updated.", user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    logger.warn({ error: error.message }, "Password reset rejected");
    return res.status(400).json({ message: "This reset link is invalid or has expired. Please request a new one." });
  }
});

// Spends a signup confirmation link's token_hash and signs the browser in.
router.post("/confirm", validate(schemas.confirmEmail), async (req, res) => {
  try {
    const { user, tokens } = await authService.confirmEmail(req.body.tokenHash);
    setSessionCookies(req, res, tokens);
    await logAudit({ req, user, action: "email_confirmed", resource: "user", resourceId: user._id, metadata: { email: user.email } });
    logger.info({ userId: user._id }, "Email confirmed");
    return res.json({ message: "Email confirmed.", user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    logger.warn({ error: error.message }, "Email confirmation failed");
    return res.status(400).json({ message: "This confirmation link is invalid or has expired." });
  }
});

// Adopts a session an OAuth provider (Google, ...) already produced client
// side. The browser talks to Supabase directly for the redirect dance
// (there is no way around that for OAuth), then hands the resulting tokens
// here so this browser ends up with the same httpOnly cookies every other
// sign-in method sets. supabaseAdmin.auth.getUser() re-verifies the token
// against Supabase itself, so a forged or stale token is rejected -- this
// route never trusts the client's claim of who it is.
router.post("/oauth/session", validate(schemas.oauthSession), async (req, res) => {
  try {
    const { accessToken, refreshToken, expiresIn } = req.body;
    const user = await verifyAccessToken(accessToken);
    if (!user) {
      return res.status(401).json({ message: "That sign-in could not be verified. Please try again." });
    }

    setSessionCookies(req, res, { accessToken, refreshToken, expiresIn });
    await logAudit({ req, user, action: "login", resource: "auth", resourceId: user._id, metadata: { email: user.email, provider: "google" } });

    logger.info({ userId: user._id, email: user.email }, "User signed in with an OAuth provider");

    return res.json({
      message: "Login successful",
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    logger.warn({ error: error.message }, "OAuth session adoption failed");
    return res.status(401).json({ message: "That sign-in could not be verified. Please try again." });
  }
});

router.post("/resend-confirmation", validate(schemas.forgotPassword), async (req, res) => {
  if (!checkPasswordResetRateLimit(req)) {
    return res.status(429).json({ message: "Too many attempts. Please try again in 15 minutes." });
  }
  try {
    await authService.resendConfirmation(req.body.email);
  } catch (error) {
    logger.warn({ error: error.message }, "Resend confirmation failed");
  }
  return res.json({ message: "If that address has an account awaiting confirmation, a new link is on its way." });
});

router.post("/logout", async (req, res) => {
  let actor = { _id: "unknown" };
  try {
    const token = req.cookies?.accessToken;
    if (token) {
      const user = await verifyAccessToken(token);
      if (user) actor = { _id: user._id };
    } else if (req.cookies?.ssr_admin) {
      actor = { _id: env.adminUsername, role: "admin" };
    }
  } catch {
    actor = { _id: "unknown" };
  }
  // Auditing must never prevent a user from ending their session.
  await logAudit({ req, user: actor, action: "logout", resource: "auth", resourceId: actor._id })
    .catch((error) => logger.warn({ error: error.message }, "Could not audit logout"));

  clearSessionCookies(req, res);
  res.clearCookie("ssr_admin", { httpOnly: true, secure: cookieSecure(req), sameSite: "strict", path: "/api" });
  res.clearCookie("x-csrf-token", { httpOnly: false, secure: cookieSecure(req), sameSite: "strict", path: "/" });

  logger.info("User logged out");
  return res.status(204).end();
});

router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token required" });
    }

    const tokens = await authService.refreshAccessToken(refreshToken);
    setSessionCookies(req, res, tokens);

    logger.info("Access token refreshed");
    return res.json({ message: "Token refreshed" });
  } catch (error) {
    logger.warn({ error: error.message }, "Token refresh failed");
    clearSessionCookies(req, res);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

router.get("/me", authenticateUserOrAdmin, (req, res) => {
  return res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      isVerified: req.user.isVerified,
      lastLogin: req.user.lastLogin
    }
  });
});

router.put("/profile", authenticateUser, validate(schemas.updateProfile), async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await authService.updateProfile(req.user._id, { name, email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await logAudit({ req, user, action: "profile_update", resource: "user", resourceId: user._id, metadata: { name, email } });

    logger.info({ userId: user._id, email }, "Profile updated successfully");

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    logger.error({ error: error.message }, "Profile update failed");

    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: "This email is already registered. Please sign in instead." });
    }

    return res.status(500).json({ message: "Profile update failed" });
  }
});

router.put("/profile/password", authenticateUser, validate(schemas.changePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user._id, currentPassword, newPassword);
    if (!result.user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!result.valid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const user = result.user;
    await logAudit({ req, user, action: "password_change", resource: "user", resourceId: user._id });

    logger.info({ userId: user._id }, "Password changed successfully");

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    logger.error({ error: error.message }, "Password change failed");
    return res.status(500).json({ message: "Password change failed" });
  }
});

router.delete("/profile", authenticateUser, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "admin") {
      return res.status(403).json({ message: "Cannot delete admin account" });
    }

    await authService.deleteAccount(req.user._id);
    await logAudit({ req, user, action: "account_deletion", resource: "user", resourceId: user._id, metadata: { email: user.email } });

    logger.info({ userId: req.user._id, email: user.email }, "Account deleted successfully");

    return res.status(204).end();
  } catch (error) {
    logger.error({ error: error.message }, "Account deletion failed");
    return res.status(500).json({ message: "Account deletion failed" });
  }
});

export default router;
