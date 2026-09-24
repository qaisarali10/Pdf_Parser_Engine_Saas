import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function supabaseConfigured() {
  return Boolean(url && anonKey);
}

let client = null;

/**
 * Browser-side Supabase client, used ONLY to drive the OAuth redirect dance
 * (signInWithOAuth + parsing the tokens Supabase's callback lands back with).
 * The anon key is public by design -- safe to ship in the bundle -- and this
 * client never stores a session: once the callback page reads the tokens, it
 * hands them to our own server (see /auth/oauth/session) which mints the
 * same httpOnly cookies every other sign-in method uses. The app's normal API
 * calls keep going through server/src routes, not through this client.
 */
export function supabaseBrowser() {
  if (!client) {
    if (!supabaseConfigured()) {
      throw new Error("Google sign-in is not configured.");
    }
    client = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: true }
    });
  }
  return client;
}
