import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { api } from "./api.js";

/**
 * Administrator user management.
 *
 * This is the way back in for someone who cannot receive mail: an admin sets
 * their password directly. Setting it also signs out that account's existing
 * sessions, which is the point when the reason for the reset is a lost or
 * shared password.
 *
 * Self-contained so it can be dropped into App.jsx's screen switch without
 * touching anything else. Pass `onNotice` to surface messages in the shell's
 * existing notice bar.
 */
export default function AdminUsers({ onNotice }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const notify = useCallback((notice) => {
    if (onNotice) onNotice(notice);
  }, [onNotice]);

  const load = useCallback(async (search) => {
    setLoading(true);
    try {
      setUsers(await api.users(search ? { q: search } : {}));
    } catch (loadError) {
      notify({ type: "error", message: loadError.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load("");
  }, [load]);

  function startReset(user) {
    setSelected(user);
    setNewPassword("");
    setError("");
  }

  async function submitReset(event) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.setUserPassword(selected.id, newPassword);
      notify({ type: "success", message: result.message });
      setSelected(null);
      setNewPassword("");
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <header className="panel-heading">
        <h2>Users</h2>
        <button type="button" className="ghost-button" onClick={() => load(query)} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          load(query);
        }}
      >
        <label className="field">
          <span>Search</span>
          <input
            value={query}
            placeholder="Name or email"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button" disabled={loading}>
          <Search size={16} /> Search
        </button>
      </form>

      <div className="data-table">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Password</th>
              </tr>
            </thead>
            <tbody>
              {users.length ? (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      {user.role === "admin" ? (
                        <span className="tag"><ShieldCheck size={14} /> admin</span>
                      ) : (
                        user.role
                      )}
                    </td>
                    <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleString() : "Never"}</td>
                    <td>
                      <button type="button" className="ghost-button" onClick={() => startReset(user)}>
                        <KeyRound size={15} /> Set password
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {loading ? "Loading users…" : "No users found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <form className="inline-form" onSubmit={submitReset}>
          <label className="field">
            <span>New password for {selected.email}</span>
            <input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary-button" disabled={busy || newPassword.length < 8}>
            {busy ? <span className="button-spinner" aria-hidden="true" /> : <KeyRound size={16} />}
            {busy ? "Updating…" : "Update password"}
          </button>
          <button type="button" className="ghost-button" onClick={() => setSelected(null)} disabled={busy}>
            Cancel
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      )}
    </section>
  );
}
