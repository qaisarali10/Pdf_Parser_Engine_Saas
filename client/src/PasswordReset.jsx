import { useEffect, useState } from "react";
import { Eye, EyeOff, LockKeyhole, MailCheck, Send } from "lucide-react";
import { api } from "./api.js";
import { useAuth } from "./AuthContext.jsx";
import { Link, useNavigate } from "./router.jsx";

// Self-contained so these can be mounted without touching the rest of App.jsx.
// They render only the card body; App.jsx wraps them in its own <AuthLayout>.

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Step 1 of the self-service reset: ask for a link.
 *
 * The API answers identically whether or not the address is registered, so this
 * screen must not imply otherwise -- saying "no account found" here would undo
 * the point of the generic response on the server.
 */
export function ForgotPasswordRequestForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    setBusy(true);
    try {
      await api.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-form">
        <div className="login-success">
          <MailCheck size={18} /> If that address has an account, a reset link is on its way.
        </div>
        <p className="auth-reset-intro">
          The link expires shortly and can only be used once. Check your spam folder if it does
          not arrive within a few minutes.
        </p>
        <button type="button" className="primary-button" onClick={() => navigate("/login")}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="auth-reset-intro">
        Enter the email address on your account and we will send you a link to choose a new password.
      </p>
      <Field label="Email address">
        <input
          name="email"
          type="email"
          value={email}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      {error && <div className="login-error">{error}</div>}
      <button type="submit" className="primary-button" disabled={busy || !email.trim()}>
        {busy ? <span className="button-spinner" aria-hidden="true" /> : <Send size={18} />}
        {busy ? "Sending link…" : "Send reset link"}
      </button>
      <p className="auth-reset-intro">
        Signing in as the built-in administrator?{" "}
        <Link className="auth-link" to="/admin-recovery">Use your recovery code</Link>.
      </p>
    </form>
  );
}

/**
 * Step 2: spend the link. Supabase's recovery link carries
 * ?token_hash=...&type=recovery on the URL.
 */
export function ResetPasswordForm() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [tokenHash, setTokenHash] = useState("");
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTokenHash(params.get("token_hash") || params.get("token") || "");
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!tokenHash) {
      setError("This reset link is incomplete. Request a new one.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("Use at least 8 characters for the new password.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setBusy(true);
    try {
      await api.resetPasswordWithToken({ tokenHash, newPassword: form.newPassword });
      // The reset link just authenticated this browser (the server set
      // fresh session cookies), so pick that session up rather than sending
      // the person back through the sign-in form.
      await refreshUser();
      setDone(true);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-form">
        <div className="login-success">Password updated. You're signed in.</div>
        <button type="button" className="primary-button" onClick={() => navigate("/app")}>
          Go to workspace
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {!tokenHash && (
        <div className="login-error">
          This reset link is missing its token. Request a new link from the sign-in page.
        </div>
      )}
      <p className="auth-reset-intro">Choose a new password for your account.</p>
      <Field label="New password">
        <div className="password-input">
          <input
            name="newPassword"
            type={showPassword ? "text" : "password"}
            value={form.newPassword}
            autoComplete="new-password"
            minLength={8}
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            required
          />
          <button
            type="button"
            className="password-toggle"
            title={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </Field>
      <Field label="Confirm new password">
        <input
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          value={form.confirmPassword}
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
          required
        />
      </Field>
      {error && <div className="login-error">{error}</div>}
      <button
        type="submit"
        className="primary-button"
        disabled={busy || !tokenHash || !form.newPassword || !form.confirmPassword}
      >
        {busy ? <span className="button-spinner" aria-hidden="true" /> : <LockKeyhole size={18} />}
        {busy ? "Updating password…" : "Set new password"}
      </button>
    </form>
  );
}

/**
 * Spends a signup confirmation link. Supabase's link carries
 * ?token_hash=...&type=email (or type=signup, depending on template) on the
 * URL; the server verifies it and signs this browser straight in.
 */
export function EmailConfirmForm() {
  const navigate = useNavigate();
  const { confirmEmail } = useAuth();
  const [status, setStatus] = useState("confirming");
  const [error, setError] = useState("");

  useEffect(() => {
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash") || "";
    if (!tokenHash) {
      setStatus("error");
      setError("This confirmation link is missing its token. Request a new one from the sign-in page.");
      return;
    }

    confirmEmail(tokenHash)
      .then(() => setStatus("done"))
      .catch((confirmError) => {
        setStatus("error");
        setError(confirmError.message);
      });
  }, [confirmEmail]);

  if (status === "confirming") {
    return (
      <div className="auth-form">
        <div className="login-success">
          <span className="button-spinner" aria-hidden="true" /> Confirming your email…
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="auth-form">
        <div className="login-success">
          <MailCheck size={18} /> Email confirmed. You're signed in.
        </div>
        <button type="button" className="primary-button" onClick={() => navigate("/app")}>
          Go to workspace
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="login-error">{error}</div>
      <button type="button" className="primary-button" onClick={() => navigate("/login")}>
        Back to sign in
      </button>
    </div>
  );
}
