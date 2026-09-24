import { createSupabaseAuthClient, supabaseAdmin } from "./supabaseClient.js";
import { env } from "../config/env.js";

function duplicateEmailError() {
  return new Error("Email already registered");
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function redirectTo(path) {
  return `${env.appUrl.replace(/\/$/, "")}${path}`;
}

async function loadProfile(userId) {
  const { data } = await supabaseAdmin().from("profiles").select("name, role").eq("id", userId).maybeSingle();
  return data || { name: "", role: "user" };
}

function mapUser(supabaseUser, profile) {
  if (!supabaseUser) return null;
  return {
    _id: supabaseUser.id,
    id: supabaseUser.id,
    name: profile?.name || supabaseUser.user_metadata?.name || "",
    email: supabaseUser.email,
    role: profile?.role || "user",
    isVerified: Boolean(supabaseUser.email_confirmed_at),
    lastLogin: supabaseUser.last_sign_in_at || null,
    createdAt: supabaseUser.created_at
  };
}

export function createAuthService() {
  async function register({ name, email, password }) {
    const authClient = createSupabaseAuthClient();
    const normalizedEmail = normalizeEmail(email);

    const { data, error } = await authClient.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { name: String(name).trim() },
        emailRedirectTo: redirectTo("/confirm")
      }
    });

    if (error) {
      if (/already registered|already exists|already in use/i.test(error.message)) throw duplicateEmailError();
      throw new Error(error.message);
    }

    // Supabase answers a sign-up for an email that already has a confirmed
    // account with a 200 and a user carrying no identities, not an error --
    // the same anti-enumeration shape it uses for password reset. Detect it
    // here so the caller still sees a normal duplicate-email failure.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw duplicateEmailError();
    }

    return {
      user: mapUser(data.user, { name: String(name).trim(), role: "user" }),
      session: data.session,
      needsConfirmation: !data.session
    };
  }

  async function login({ username, password }) {
    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.signInWithPassword({
      email: normalizeEmail(username),
      password
    });

    if (error) {
      if (/email not confirmed/i.test(error.message)) throw new Error("Email not confirmed. Check your inbox for the confirmation link.");
      throw new Error("Invalid username or password");
    }

    const profile = await loadProfile(data.user.id);
    return { user: mapUser(data.user, profile), tokens: sessionToTokens(data.session) };
  }

  function sessionToTokens(session) {
    if (!session) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in || 3600
    };
  }

  async function refreshAccessToken(refreshToken) {
    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new Error("Invalid refresh token");
    return sessionToTokens(data.session);
  }

  /**
   * Verifies a signup or recovery link's token_hash and returns a fresh
   * session, or throws if the link is invalid/expired/already used.
   */
  async function verifyOtp(tokenHash, type) {
    const authClient = createSupabaseAuthClient();
    const { data, error } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error || !data.session) throw new Error(error?.message || "This link is invalid or has expired.");
    const profile = await loadProfile(data.user.id);
    return { user: mapUser(data.user, profile), tokens: sessionToTokens(data.session) };
  }

  async function confirmEmail(tokenHash) {
    return verifyOtp(tokenHash, "email");
  }

  async function getUserById(userId) {
    if (!userId) return null;
    const { data, error } = await supabaseAdmin().auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    return mapUser(data.user, await loadProfile(userId));
  }

  async function updateProfile(userId, { name, email }) {
    const normalizedEmail = normalizeEmail(email);
    const trimmedName = String(name).trim();

    const { data, error } = await supabaseAdmin().auth.admin.updateUserById(userId, { email: normalizedEmail });
    if (error) {
      if (/already registered|already exists|already in use/i.test(error.message)) throw duplicateEmailError();
      throw new Error(error.message);
    }

    await supabaseAdmin().from("profiles").update({ name: trimmedName, updated_at: new Date().toISOString() }).eq("id", userId);
    return mapUser(data.user, { name: trimmedName, role: (await loadProfile(userId)).role });
  }

  async function changePassword(userId, currentPassword, newPassword) {
    const user = await getUserById(userId);
    if (!user) return { user: null, valid: false };

    const authClient = createSupabaseAuthClient();
    const { error: signInError } = await authClient.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (signInError) return { user, valid: false };

    const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, { password: newPassword });
    if (error) throw new Error(error.message);

    return { user, valid: true };
  }

  async function deleteAccount(userId) {
    const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
    return !error;
  }

  /**
   * Self-service reset, step 1: ask Supabase to email a recovery link.
   * Supabase itself gives the same generic answer whether or not the address
   * has an account, so this never reveals which email addresses exist.
   */
  async function requestPasswordReset(email) {
    const authClient = createSupabaseAuthClient();
    await authClient.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: redirectTo("/reset-password")
    });
  }

  /**
   * Self-service reset, step 2: spend the link's token_hash and set the new
   * password. Returns a fresh session so the caller can sign the browser in.
   */
  async function resetPassword(tokenHash, newPassword) {
    const { user, tokens } = await verifyOtp(tokenHash, "recovery");
    const { error } = await supabaseAdmin().auth.admin.updateUserById(user.id, { password: newPassword });
    if (error) throw new Error(error.message);
    return { user, tokens };
  }

  /**
   * Administrator-set password. Used when someone cannot receive mail, so it
   * deliberately does not require the current password -- the caller must
   * already be authorised as an admin.
   */
  async function setPassword(userId, newPassword) {
    const user = await getUserById(userId);
    if (!user) return null;
    const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, { password: newPassword });
    if (error) throw new Error(error.message);
    return user;
  }

  async function resendConfirmation(email) {
    const authClient = createSupabaseAuthClient();
    await authClient.auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: { emailRedirectTo: redirectTo("/confirm") }
    });
  }

  async function listUsers({ q, limit = 50 } = {}) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const { data, error } = await supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(error.message);

    const { data: profiles } = await supabaseAdmin().from("profiles").select("id, name, role");
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));

    const needle = String(q || "").trim().toLowerCase();
    return data.users
      .map((user) => mapUser(user, profileById.get(user.id)))
      .filter((user) => !needle || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, cappedLimit)
      .map((user) => ({ ...user, _id: user.id }));
  }

  return {
    register,
    login,
    refreshAccessToken,
    confirmEmail,
    resendConfirmation,
    getUserById,
    updateProfile,
    changePassword,
    deleteAccount,
    requestPasswordReset,
    resetPassword,
    setPassword,
    listUsers
  };
}
