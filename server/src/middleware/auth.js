import { createAuthService } from "../services/authService.js";
import { supabaseAdmin } from "../services/supabaseClient.js";
import { createLogger } from "../services/logger.js";

const logger = createLogger({ module: "auth" });
const authService = createAuthService();

/**
 * Resolves the `accessToken` cookie to a user via Supabase (it verifies the
 * JWT's signature/expiry itself), then loads the profile row for role/name.
 */
export async function verifyAccessToken(token) {
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  return authService.getUserById(data.user.id);
}

export async function authenticateUser(req, res, next) {
  try {
    const token = req.cookies?.accessToken;
    if (!token) {
      return res.status(401).json({ message: "Access token required" });
    }

    const user = await verifyAccessToken(token);
    if (!user) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = user;
    req.log = req.log?.child({ userId: user._id, email: user.email });

    next();
  } catch (error) {
    logger.warn({ error: error.message }, "Authentication failed");
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
}

export async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies?.accessToken;
    if (token) {
      const user = await verifyAccessToken(token);
      if (user) req.user = user;
    }
  } catch {
    // Silently ignore auth errors for optional auth
  }

  next();
}
