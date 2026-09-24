import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { supabaseBrowser } from "./supabaseClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshUser = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.me();
      setUser(result.user);
      return result.user;
    } catch (authError) {
      setUser(null);
      if (authError.status !== 401) setError(authError.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async ({ username, password, remember }) => {
    setError("");
    const result = await api.login({ username, password }, { remember });
    const nextUser = result.user || { username };
    setUser(nextUser);
    return nextUser;
  }, []);

  const signup = useCallback(async ({ name, email, password }) => {
    setError("");
    const result = await api.register({ name, email, password });
    // A brand-new account only gets a session once its email is confirmed
    // (Supabase withholds one until then), so there is nothing to adopt yet
    // -- the caller shows a "check your email" screen instead.
    if (result.needsConfirmation) {
      return result;
    }
    const nextUser = result.user || { email };
    setUser(nextUser);
    return result;
  }, []);

  const confirmEmail = useCallback(async (tokenHash) => {
    setError("");
    const result = await api.confirmEmail({ tokenHash });
    const nextUser = result.user;
    setUser(nextUser);
    return nextUser;
  }, []);

  // Kicks off the redirect to Google. The browser leaves the app entirely
  // here, goes to Google then to Supabase's own callback, and lands back on
  // /oauth/callback with a session -- there is no way to do this without a
  // full-page redirect through a provider Supabase itself talks to.
  const signInWithGoogle = useCallback(async () => {
    setError("");
    const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/oauth/callback` }
    });
    if (oauthError) throw new Error(oauthError.message);
  }, []);

  // Called by the /oauth/callback page once supabase-js has parsed the
  // tokens out of the redirect: hands them to the server so this browser
  // gets the same httpOnly cookies every other sign-in method sets.
  const adoptOAuthSession = useCallback(async ({ accessToken, refreshToken, expiresIn }) => {
    setError("");
    const result = await api.oauthSession({ accessToken, refreshToken, expiresIn });
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Always end the local session, even if the browser lost its connection
      // before the server could acknowledge the logout request.
      setUser(null);
      setError("");
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      isAuthenticated: Boolean(user),
      login,
      signup,
      confirmEmail,
      signInWithGoogle,
      adoptOAuthSession,
      logout,
      refreshUser
    }),
    [adoptOAuthSession, confirmEmail, error, loading, login, logout, refreshUser, signInWithGoogle, signup, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
