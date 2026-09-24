/**
 * Determine whether cookies should be marked Secure.
 *
 * The Secure attribute must match the actual transport security of the
 * request. Using `req.secure` (which respects the `trust proxy` setting)
 * means:
 *   - localhost dev over http  -> false (browsers reject Secure over http)
 *   - localhost dev over https -> true
 *   - production behind https  -> true (with TRUST_PROXY=true)
 *   - plain http deployments   -> false (cookie still functions)
 *
 * This is safer than keying off NODE_ENV, which would set Secure on an
 * http://localhost connection and cause the browser to silently drop every
 * cookie.
 */
export function cookieSecure(req) {
  return Boolean(req?.secure);
}