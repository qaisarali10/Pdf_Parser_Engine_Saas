/**
 * Authorization middleware - checks permissions after authentication
 * Separated from authentication for Single Responsibility Principle
 */

/**
 * Authorize user based on role
 * @param {...String} allowedRoles - Allowed roles (e.g., "admin", "user")
 * @returns {Function} Express middleware
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    // Must be authenticated first
    if (!req.user && !req.admin) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    // Admin can do anything
    if (req.admin) {
      return next();
    }
    
    // Check if user has required role
    if (req.user && allowedRoles.includes(req.user.role)) {
      return next();
    }
    
    return res.status(403).json({ 
      message: `Insufficient permissions. Required: ${allowedRoles.join(" or ")}` 
    });
  };
}

/**
 * Authorize admin only
 * Shortcut for authorize("admin")
 */
export function adminOnly(req, res, next) {
  return authorize("admin")(req, res, next);
}

/**
 * Authorize authenticated users (admin or user)
 * Shortcut for authorize("admin", "user")
 */
export function anyAuthenticated(req, res, next) {
  return authorize("admin", "user")(req, res, next);
}