import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let adminClient = null;

export function supabaseConfigured() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

/**
 * Service-role client: every DB read/write and every `auth.admin.*` call goes
 * through this. It bypasses Row Level Security, so ownership is enforced in
 * application code (server/src/utils/ownership.js), the same way it was
 * against MongoDB. Never send this key to the browser.
 */
export function supabaseAdmin() {
  if (!adminClient) {
    if (!supabaseConfigured()) {
      throw new Error("Supabase is not configured");
    }
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return adminClient;
}

/**
 * Anon-key client, request-scoped, used only for the credential-facing auth
 * calls (signUp, signInWithPassword, resetPasswordForEmail, verifyOtp,
 * refreshSession) -- the ones Supabase itself rate-limits and emails from.
 * A fresh instance per call keeps one request's session from leaking into
 * another's, since these methods can mutate in-memory session state.
 */
export function createSupabaseAuthClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase is not configured");
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}
