/**
 * Ownership and access control utilities.
 * Centralizes all ownership logic for the multi-tenant SaaS.
 */

// The built-in (non-Supabase) administrator authenticates via the `ssr_admin`
// cookie and has no row in auth.users, so it cannot own a `user_id uuid`
// column. Rows it creates are attributed to this fixed, well-known id instead
// (a nil-ish uuid, guaranteed never to collide with a real auth.users id).
export const BUILT_IN_ADMIN_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Check if user has admin role
 * @param {Object} user - User object from req.user
 * @returns {Boolean} True if user is admin
 */
export function isAdmin(user) {
  return Boolean(user && user.role === "admin");
}

/**
 * Build a Supabase filter for the caller: `null` for an admin (no filter =
 * all data), otherwise `{ user_id: <uuid> }` for a regular user.
 * @param {Object} user - User object from req.user
 * @returns {{user_id?: string}} filter to apply with `.match()`, or {} for admin
 */
export function buildUserFilter(user) {
  if (!user || isAdmin(user)) return {};
  return { user_id: getUserId(user) };
}

/**
 * Get the uuid to store in `user_id` for create operations. Returns the
 * user's own id for both admin and regular users; the built-in admin's
 * synthetic id is not a real auth.users uuid, so it is mapped to a fixed
 * constant instead.
 * @param {Object} user - User object from req.user
 * @returns {string} uuid
 */
export function getUserId(user) {
  if (!user) return null;
  const value = String(user._id || user.id || "");
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    return value;
  }
  return BUILT_IN_ADMIN_ID;
}

/**
 * Verify ownership of a resource
 * Admin can access everything
 * Regular users can only access their own resources
 * @param {Object} user - User object from req.user
 * @param {Object} resource - Resource row from the store (camelCase `userId` or raw `user_id`)
 * @returns {Boolean} True if user owns the resource or is admin
 */
export function verifyOwnership(user, resource) {
  if (isAdmin(user)) return true;

  const owner = resource?.userId ?? resource?.user_id;
  if (!resource || !owner) return false;

  return String(owner) === String(getUserId(user));
}

/**
 * Check if user can access a resource
 * @param {Object} user - User object from req.user
 * @param {Object} resource - Resource row from the store
 * @returns {Boolean} True if user can access
 */
export function canAccess(user, resource) {
  return verifyOwnership(user, resource);
}

/**
 * Check if user can modify a resource
 * @param {Object} user - User object from req.user
 * @param {Object} resource - Resource row from the store
 * @returns {Boolean} True if user can modify
 */
export function canModify(user, resource) {
  return verifyOwnership(user, resource);
}

/**
 * Auto-assign user to resource data on create
 * @param {Object} user - User object from req.user
 * @param {Object} data - Resource data
 * @returns {Object} Data with user_id field added
 */
export function assignOwnership(user, data) {
  return {
    ...data,
    user_id: getUserId(user)
  };
}

/**
 * Validate that user has access to resource
 * Throws error if access denied
 * @param {Object} user - User object from req.user
 * @param {Object} resource - Resource row from the store
 * @param {String} resourceName - Name of resource for error message
 * @throws {Error} 403 if access denied
 */
export function validateAccess(user, resource, resourceName = "resource") {
  if (!canAccess(user, resource)) {
    throw new Error(`Access denied: You do not own this ${resourceName}`);
  }
}

/**
 * Validate that user can modify resource
 * Throws error if cannot modify
 * @param {Object} user - User object from req.user
 * @param {Object} resource - Resource row from the store
 * @param {String} resourceName - Name of resource for error message
 * @throws {Error} 403 if cannot modify
 */
export function validateModification(user, resource, resourceName = "resource") {
  if (!canModify(user, resource)) {
    throw new Error(`Access denied: You cannot modify this ${resourceName}`);
  }
}
