import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "./router.jsx";
import { clampCursor, moveCursor } from "./commandCursor.js";
import { dateTime, humanize, shortId, uploadTone } from "./format.js";
import {
  Activity,
  AlertTriangle,
  AtSign,
  BarChart3,
  Briefcase,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Home,
  KeyRound,
  Layers3,
  LockKeyhole,
  LogOut,
  Mail,
  MailCheck,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
  Users,
  X,
  XCircle
} from "lucide-react";
import { api } from "./api.js";
import { useAuth } from "./AuthContext.jsx";
import { EmptyState, SkeletonBlock } from "./ui.jsx";
import { EmailConfirmForm, ForgotPasswordRequestForm, ResetPasswordForm } from "./PasswordReset.jsx";
import { supabaseBrowser } from "./supabaseClient.js";

const AnalyticsCharts = lazy(() => import("./AnalyticsCharts.jsx"));

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Shown on the search control and in the palette footer. navigator.platform is
// deprecated but still the most reliable signal, with the user-agent as backup.
const SHORTCUT_LABEL = typeof navigator !== "undefined"
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "")
  ? "⌘K"
  : "Ctrl K";

const navItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "dashboard", label: "Admin Panel", icon: BarChart3 },
  { id: "profile", label: "Profile", icon: User },
  { id: "network", label: "Network", icon: Building2 },
  { id: "ssr", label: "SSR Upload", icon: UploadCloud },
  { id: "check", label: "Check Data", icon: ClipboardCheck },
  { id: "products", label: "Products", icon: Package },
  { id: "schemes", label: "Schemes", icon: Layers3 },
  { id: "services", label: "Other Services", icon: Briefcase },
  { id: "missing", label: "Missing", icon: AlertTriangle },
  { id: "summary", label: "Summary", icon: FileSpreadsheet },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "audit", label: "Audit Log", icon: ClipboardList }
];

const navGroups = [
  { label: "Overview", items: ["home", "dashboard", "profile"] },
  { label: "Operations", items: ["network", "ssr", "check", "products", "schemes", "services", "missing"] },
  { label: "Insights", items: ["summary", "reports", "audit"] }
];

const pageDescriptions = {
  home: "Your operational overview and recent activity",
  dashboard: "Performance metrics, trends, and business activity",
  profile: "Account details and security preferences",
  network: "Manage companies and distributor relationships",
  ssr: "Upload and process monthly sales stock reports",
  check: "Validate report data before importing",
  products: "Maintain products and distributor aliases",
  schemes: "Review and import product schemes",
  services: "Manage additional distributor services",
  missing: "Resolve unmatched product aliases",
  summary: "Review monthly data quality and totals",
  reports: "Build and export operational reports",
  audit: "Trace account and data changes"
};

function currentMonth() {
  return months[new Date().getMonth()];
}

function currency(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// "products", "products and sales", "products, sales and analytics"
function listSentence(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Notice({ notice, onClear }) {
  if (!notice) return null;
  const Icon = notice.type === "error" ? XCircle : notice.type === "warn" ? AlertTriangle : CheckCircle2;
  return (
    <div className={`notice ${notice.type || "success"}`}>
      <Icon size={18} />
      <span>{notice.message}</span>
      <button type="button" className="icon-button" title="Dismiss" onClick={onClear}>
        <XCircle size={16} />
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Transparent over the hero, solid once the page moves under it.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 8);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      navigate("/", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className={`site-navbar${scrolled ? " is-scrolled" : ""}`}>
      <div className="site-navbar-inner">
        <Link className="brand nav-brand" to={isAuthenticated ? "/app" : "/"}>
          <div className="brand-mark">SSR</div>
          <div>
            <strong>Sales Stock Report</strong>
            <span>Sales, Stock & Reporting</span>
          </div>
        </Link>
        {!isAuthenticated && (
          <nav className="nav-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </nav>
        )}
        <nav className="nav-actions">
          {isAuthenticated ? (
            <>
              <span className="nav-profile">
                <LockKeyhole size={15} />
                {user?.name || user?.username || user?.email || "Profile"}
              </span>
              <button type="button" className="ghost-button logout-action" onClick={handleLogout} disabled={isLoggingOut} aria-busy={isLoggingOut}>
                {isLoggingOut ? <span className="button-spinner" aria-hidden="true" /> : <LogOut size={17} />}
                {isLoggingOut ? "Signing out…" : "Logout"}
              </button>
            </>
          ) : (
            <>
              {location.pathname !== "/login" && <Link className="ghost-link" to="/login">Sign in</Link>}
              {location.pathname !== "/signup" && <Link className="primary-link" to="/signup">Create account</Link>}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="route-loading">
        <RefreshCw size={22} />
        <span>Loading session</span>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({ open, title, description, onClose, children, size = "default" }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    // Whatever opened the dialog gets the focus back when it closes, so a
    // keyboard user is not dropped at the top of the page afterwards.
    const opener = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Without this the tab order walks straight out of the dialog and into
      // the page behind it, which is still inert to the mouse.
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])
        .filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Hold the page still behind the dialog so the background cannot scroll
    // away underneath it while a form is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.querySelector(FOCUSABLE)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function UserMenu({ currentUser, currentEmail, currentRole, onOpenProfile, onRefresh, onLogout, isLoggingOut }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const initial = String(currentUser || "A").charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function run(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className={`user-menu-trigger ${open ? "open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="user-menu-avatar" aria-hidden="true">{initial}</span>
        {/* Name only. The role lives in the panel below, where it has room to
            be a legible badge rather than 10.5px of grey text wedged under the
            name. (It was once hardcoded to "Administrator" here, which told
            every signed-in user they were an admin.) */}
        <span className="user-menu-identity">
          <strong>{currentUser}</strong>
        </span>
        <ChevronDown size={15} className="user-menu-caret" />
      </button>
      {open && (
        <div className="user-menu-popover" role="menu">
          {/* The trigger already shows the name, so the panel adds the
              detail it cannot fit: the account it belongs to. */}
          <div className="user-menu-head">
            <span className="user-menu-avatar large" aria-hidden="true">{initial}</span>
            <div>
              <span className="user-menu-name-row">
                <strong title={currentUser}>{currentUser}</strong>
                {currentRole && <span className="user-menu-role">{currentRole}</span>}
              </span>
              <small title={currentEmail || undefined}>{currentEmail || "No email on file"}</small>
            </div>
          </div>
          <button type="button" role="menuitem" onClick={() => run(onOpenProfile)}>
            <User size={16} />
            Your profile
          </button>
          <button type="button" role="menuitem" onClick={() => run(onRefresh)}>
            <RefreshCw size={16} />
            Refresh data
          </button>
          <div className="user-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-signout"
            disabled={isLoggingOut}
            aria-busy={isLoggingOut}
            onClick={() => run(onLogout)}
          >
            {isLoggingOut ? <span className="button-spinner" aria-hidden="true" /> : <LogOut size={16} />}
            {isLoggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function PanelHeading({ title, action }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function FileField({ label, onChange }) {
  return (
    <Field label={label}>
      <input type="file" accept=".xlsx" onChange={(event) => onChange(event.target.files?.[0] || null)} />
    </Field>
  );
}

const PAGE_SIZES = [10, 25, 50, 100];

function DataTable({ columns, rows = [], empty = "No records found.", pageSize = 25 }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * size;
  const visibleRows = rows.slice(start, start + size);

  useEffect(() => {
    setPage(1);
  }, [rows.length, size]);

  return (
    <div className="data-table">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              visibleRows.map((row, index) => (
                <tr key={row.id || start + index}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.render ? column.render(row, start + index) : row[column.key]}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="empty-cell">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <footer className="table-pagination">
          <span className="table-range">
            Showing <strong>{start + 1}-{Math.min(start + size, rows.length)}</strong> of <strong>{rows.length}</strong>
          </span>
          <div className="table-pagination-controls">
            <label className="page-size">
              <span>Rows</span>
              <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
                {PAGE_SIZES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <div className="pager">
              <button type="button" aria-label="Previous page" title="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft size={16} />
              </button>
              <strong>{currentPage} / {totalPages}</strong>
              <button type="button" aria-label="Next page" title="Next page" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function Shell({ active, onActive, stats, onRefresh, children, notice, onClearNotice, currentUser, currentEmail, currentRole, onLogout, isLoggingOut }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("ssr-sidebar-collapsed") === "true");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  // Which result the keyboard is sitting on. A palette you can only finish
  // with the mouse is a search box wearing a palette's clothes.
  const [commandIndex, setCommandIndex] = useState(0);
  const commandResultsRef = useRef(null);
  const activeLabel = navItems.find((item) => item.id === active)?.label || "Home";
  const commandItems = navItems.filter((item) => item.label.toLowerCase().includes(commandQuery.trim().toLowerCase()));
  const connectionLabel = stats?.mode ? "Workspace online" : "Connecting";

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("ssr-sidebar-collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!mobileNavOpen && !commandOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen, commandOpen]);

  useEffect(() => {
    const openCommandMenu = (event) => {
      // Some IME and media keys dispatch without `key`, and calling
      // toLowerCase() on that took the whole handler down with it.
      if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", openCommandMenu);
    return () => window.removeEventListener("keydown", openCommandMenu);
  }, []);

  // A new search starts at the top of its own results.
  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandOpen]);

  // Keep the keyboard cursor in view when it walks past the fold.
  useEffect(() => {
    if (!commandOpen) return;
    commandResultsRef.current
      ?.querySelector("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [commandIndex, commandOpen]);

  function openCommandPalette() {
    setCommandQuery("");
    setCommandIndex(0);
    setCommandOpen(true);
  }

  function runCommand(id) {
    onActive(id);
    setCommandOpen(false);
    setCommandQuery("");
  }

  function onCommandKeyDown(event) {
    if (!commandItems.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCommandIndex((current) => moveCursor(current, step, commandItems.length));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const item = commandItems[clampCursor(commandIndex, commandItems.length)];
      if (item) runCommand(item.id);
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="mobile-appbar">
        <button
          type="button"
          className="mobile-menu-button"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu size={22} />
        </button>
        <div className="mobile-appbar-title">
          <strong>SSR Workspace</strong>
          <span>{activeLabel}</span>
        </div>
      </header>

      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside id="primary-navigation" className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-product">
          <div className="brand-mark">SSR</div>
          <div className="sidebar-product-copy">
            <strong>Sales Stock Report</strong>
            <span>Operations workspace</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          {/* The topbar menu already carries name, role and email; repeating
              the identity here was the third copy on one screen. */}
          <button
            type="button"
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={21} />
          </button>
        </div>
        <nav>
          {navGroups.map((group) => (
            <div className="sidebar-nav-group" key={group.label}>
              <span className="sidebar-section-label">{group.label}</span>
              {group.items.map((id) => {
                const item = navItems.find((entry) => entry.id === id);
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={active === item.id ? "active" : ""}
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={() => {
                      onActive(item.id);
                      setMobileNavOpen(false);
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>System online</strong>
            <span>{stats?.mode ? "Operational data ready" : "Connecting..."}</span>
          </div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div>
            <h1>{activeLabel}</h1>
            <p className="page-description">{pageDescriptions[active]}</p>
          </div>
          <div className="topbar-actions">
            {/* The Ctrl/Cmd+K binding already existed but nothing said so, so
                nobody used it. The chip is the whole point of the control. */}
            <button
              type="button"
              className="workspace-search-button"
              onClick={openCommandPalette}
              title={`Search pages (${SHORTCUT_LABEL})`}
            >
              <Search size={16} />
              <span>Search pages</span>
              <kbd className="kbd-hint">{SHORTCUT_LABEL}</kbd>
            </button>
            <span className="topbar-status" title="Current data connection">
              <span className="status-dot" />
              {connectionLabel}
            </span>
            <UserMenu
              currentUser={currentUser}
              currentEmail={currentEmail}
              currentRole={currentRole}
              onOpenProfile={() => onActive("profile")}
              onRefresh={onRefresh}
              onLogout={onLogout}
              isLoggingOut={isLoggingOut}
            />
          </div>
        </header>
        <Notice notice={notice} onClear={onClearNotice} />
        {/* Keyed on the active screen so switching pages replays the
            enter transition instead of swapping content instantly. */}
        <div className="screen-enter" key={active}>
          {children}
        </div>
      </main>
      {commandOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}>
          <section className="command-menu" role="dialog" aria-modal="true" aria-label="Find a workspace page" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-search">
              <Search size={18} />
              <input
                autoFocus
                value={commandQuery}
                placeholder="Search pages"
                aria-label="Search pages"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-results"
                aria-activedescendant={commandItems[commandIndex] ? `command-option-${commandItems[commandIndex].id}` : undefined}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={onCommandKeyDown}
              />
              <button type="button" className="icon-button" aria-label="Close page finder" onClick={() => setCommandOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <div className="command-results" id="command-results" role="listbox" ref={commandResultsRef}>
              {commandItems.map((item, index) => {
                const Icon = item.icon;
                const isCursor = index === commandIndex;
                return (
                  <button
                    type="button"
                    key={item.id}
                    id={`command-option-${item.id}`}
                    role="option"
                    aria-selected={isCursor}
                    data-active={isCursor}
                    className={`${active === item.id ? "current" : ""} ${isCursor ? "is-cursor" : ""}`}
                    // Pointing at a row moves the cursor there, so the mouse
                    // and the keyboard never disagree about what Enter does.
                    onMouseMove={() => setCommandIndex(index)}
                    onClick={() => runCommand(item.id)}
                  >
                    <Icon size={17} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{pageDescriptions[item.id]}</small>
                    </span>
                    {active === item.id && <em className="command-current-tag">Current</em>}
                  </button>
                );
              })}
              {!commandItems.length && <div className="command-empty">No matching page found.</div>}
            </div>
            <footer className="command-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>esc</kbd> close</span>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

// Renders as a button when `onOpen` is supplied, so a figure on the overview
// is also the way to the screen behind it. Without it the card stays a plain
// div, which is what the summary and analytics grids want.
function StatCard({ icon: Icon, label, value, tone, loading, onOpen }) {
  const body = (
    <>
      <Icon size={22} />
      <div>
        <span>{label}</span>
        {/* Rendering 0 while the count is still in flight states a number the
            server never sent, so the figure is withheld until it arrives. */}
        {loading ? <strong className="stat-pending" aria-hidden="true" /> : <strong>{Number(value || 0).toLocaleString()}</strong>}
      </div>
      {onOpen && <ChevronRight size={16} className="stat-card-go" aria-hidden="true" />}
    </>
  );

  if (!onOpen) {
    return <div className={`stat-card ${tone || ""}`}>{body}</div>;
  }

  return (
    <button type="button" className={`stat-card is-link ${tone || ""}`} onClick={onOpen}>
      {body}
    </button>
  );
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Upload timestamps are most useful as "how long ago", which is the question
// someone scanning recent activity is actually asking.
function timeAgo(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fileMetric(row) {
  if (row.inserted) return `${row.inserted} inserted`;
  if (row.created) return `${row.created} created`;
  if (row.missingCount) return `${row.missingCount} missing`;
  return `${row.rowCount || 0} rows`;
}

function HomeScreen({ stats, sales, fileActivity, loading, onOpen }) {
  const { user } = useAuth();
  const latestSale = sales[0];
  const latestPeriod = latestSale ? `${String(latestSale.month || "").toUpperCase()} ${latestSale.year || ""}` : "No SSR data";
  const lastFile = fileActivity[0];
  const homeActions = [
    {
      id: "dashboard",
      label: "Admin Panel",
      detail: "Open full controls",
      icon: BarChart3
    },
    {
      id: "ssr",
      label: "SSR Upload",
      detail: "Process monthly Excel",
      icon: UploadCloud
    },
    {
      id: "check",
      label: "Check Data",
      detail: "Find missing aliases",
      icon: ClipboardCheck
    },
    {
      id: "summary",
      label: "Summary",
      detail: "Review quality reports",
      icon: FileSpreadsheet
    },
    {
      id: "missing",
      label: "Missing",
      detail: "Save detected aliases",
      icon: AlertTriangle
    },
    {
      id: "services",
      label: "Other Services",
      detail: "Manage extra services",
      icon: Briefcase
    }
  ];

  const now = new Date();
  const firstName = String(user?.name || user?.username || "").trim().split(/\s+/)[0];

  // The counts double as navigation: the question "how many products?" is
  // usually the first half of "...and let me see them".
  const metrics = [
    { key: "companies", icon: Building2, label: "Companies", value: stats?.companies, target: "network" },
    { key: "distributors", icon: Users, label: "Distributors", value: stats?.distributors, target: "network" },
    { key: "products", icon: Package, label: "Products", value: stats?.products, target: "products" },
    { key: "files", icon: FileSpreadsheet, label: "Files", value: stats?.files, target: "check" },
    { key: "services", icon: Briefcase, label: "Services", value: stats?.services, target: "services" }
  ];

  return (
    <section className="home-screen">
      {/* A workspace banner, not a landing hero: it greets, dates the session
          and carries the two facts that decide what you do next. The marketing
          headline and blurb that used to sit here said nothing to someone who
          had already signed in, and the distributor count it showed was
          repeated in the card directly beneath it. */}
      <header className="home-banner">
        <div className="home-banner-copy">
          <span className="home-banner-date">
            {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </span>
          <h2>{greetingFor(now)}{firstName ? `, ${firstName}` : ""}</h2>
        </div>
        <dl className="home-banner-facts">
          <div>
            <dt>Latest SSR period</dt>
            {loading ? <dd className="stat-pending on-dark" aria-hidden="true" /> : <dd>{latestPeriod}</dd>}
          </div>
          <div>
            <dt>Last file</dt>
            {loading
              ? <dd className="stat-pending on-dark" aria-hidden="true" />
              : <dd title={lastFile?.filename || undefined}>{lastFile?.filename || "No file yet"}</dd>}
          </div>
        </dl>
      </header>

      <div className="home-stat-row" aria-busy={loading}>
        {metrics.map((metric) => (
          <StatCard
            key={metric.key}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            loading={loading}
            onOpen={() => onOpen(metric.target)}
          />
        ))}
      </div>

      {/* Two columns so the page has a shape, but only for the two panels that
          are a similar height. The wide table sits below at full width: at
          two-thirds it squeezed five columns into a space that truncated the
          distributor names, and it left the shorter rail beside it trailing a
          block of empty page. */}
      <div className="home-body">
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-title">
              <h2>Start work</h2>
              <p>Jump straight into a task.</p>
            </div>
          </div>
          <div className="home-action-grid">
            {homeActions.map((item) => {
              const Icon = item.icon;
              return (
                <button type="button" className="home-action" key={item.id} onClick={() => onOpen(item.id)}>
                  <Icon size={22} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* File activity was already being fetched and then thrown away, save
            for the single filename in the banner. */}
        <aside className="panel home-activity">
          <div className="panel-heading">
            <div className="panel-title">
              <h2>Recent activity</h2>
              <p>Files this workspace has processed.</p>
            </div>
          </div>
          {fileActivity.length ? (
            <ul className="activity-list">
              {fileActivity.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <span className={`activity-dot ${row.status === "failed" ? "is-failed" : ""}`} aria-hidden="true" />
                  <div className="activity-body">
                    <strong title={row.filename}>{row.filename || "Untitled file"}</strong>
                    <small>
                      <span className="activity-kind">{row.kind}</span>
                      {fileMetric(row)}
                    </small>
                  </div>
                  <time dateTime={row.createdAt}>{timeAgo(row.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="activity-empty">{loading ? "Loading activity…" : "No files processed yet."}</p>
          )}
        </aside>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Latest sales</h2>
            <p>The five most recent rows processed.</p>
          </div>
          <button type="button" className="link-button" onClick={() => onOpen("summary")}>
            Open summary <ChevronRight size={15} />
          </button>
        </div>
        <DataTable
          rows={sales.slice(0, 5)}
          pageSize={5}
          columns={[
            { key: "date", label: "Date", render: (row) => new Date(row.date).toLocaleDateString() },
            { key: "distributor", label: "Distributor", render: (row) => row.distributor?.dname || "" },
            { key: "product", label: "Product", render: (row) => row.product?.pname || "" },
            { key: "month", label: "Period", render: (row) => `${String(row.month || "").toUpperCase()} ${row.year || ""}` },
            { key: "clvalue", label: "CL Value", render: (row) => currency(row.clvalue) }
          ]}
          empty={loading ? "Loading recent sales…" : "No recent sales yet."}
        />
      </section>
    </section>
  );
}

function PanelOptions({ onOpen }) {
  return (
    <section className="panel wide">
      <div className="panel-heading">
        <h2>Quick Links</h2>
      </div>
      <div className="option-grid compact">
        {navItems.filter((item) => !["home", "dashboard"].includes(item.id)).map((item) => {
          const Icon = item.icon;
          return (
            <button type="button" className="option-button" key={item.id} onClick={() => onOpen(item.id)}>
              <Icon size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChartGridFallback() {
  return (
    <div className="analytics-chart-grid">
      {Array.from({ length: 5 }).map((_, index) => <SkeletonBlock key={index} />)}
    </div>
  );
}

function Dashboard({ analytics, loadingAnalytics, onOpen }) {
  const cards = analytics?.cards || {};
  const charts = analytics?.charts || {};
  const recent = analytics?.recent || {};

  return (
    <section className="dashboard-analytics">
      <div className="stat-grid dashboard-card-grid">
        {loadingAnalytics ? (
          Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} height={92} />)
        ) : (
          <>
            {/* "Total" on all six carried no information: every card on this
                grid is a total, so the word only pushed the labels wider. */}
            <StatCard icon={Building2} label="Companies" value={cards.companies} />
            <StatCard icon={Package} label="Products" value={cards.products} />
            <StatCard icon={Users} label="Distributors" value={cards.distributors} />
            <StatCard icon={Activity} label="Sales" value={cards.sales} />
            <StatCard icon={Briefcase} label="Services" value={cards.services} />
            <StatCard icon={FileSpreadsheet} label="Uploads" value={cards.uploads} />
          </>
        )}
      </div>

      <Suspense fallback={<ChartGridFallback />}>
        <AnalyticsCharts charts={charts} loading={loadingAnalytics} />
      </Suspense>

      {/* These three tables render the same records as the Audit and Missing
          screens, so they are given the same treatment: a person rather than
          an id, a badge rather than a lowercase slug, and figures that line up
          on their digits. */}
      <section className="panel wide">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Latest audit logs</h2>
            <p>The most recent activity across this workspace.</p>
          </div>
          <button type="button" className="link-button" onClick={() => onOpen("audit")}>
            Open audit log <ChevronRight size={15} />
          </button>
        </div>
        <DataTable
          rows={recent.auditLogs || []}
          columns={[
            { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
            {
              key: "user",
              label: "User",
              render: (row) => (
                <span className="audit-actor">
                  {auditActor(row) ? <strong>{auditActor(row)}</strong> : <strong className="audit-muted">Unknown</strong>}
                  {row.user && <small title={row.user}>{shortId(row.user)}</small>}
                </span>
              )
            },
            { key: "action", label: "Action", render: (row) => <span className="audit-action">{humanize(row.action)}</span> },
            { key: "resource", label: "Resource", render: (row) => humanize(row.resource) },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`audit-status ${row.status === "failure" ? "failure" : "success"}`}>
                  {row.status === "failure" ? "Failed" : "Success"}
                </span>
              )
            }
          ]}
          empty={loadingAnalytics ? "Loading audit logs…" : "No audit logs yet."}
        />
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Latest uploads</h2>
            <p>Files processed, and what came of them.</p>
          </div>
        </div>
        <DataTable
          rows={recent.uploads || []}
          columns={[
            { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
            { key: "kind", label: "Type", render: (row) => <span className="activity-kind">{row.kind}</span> },
            { key: "filename", label: "File", render: (row) => <span className="cell-file" title={row.filename}>{row.filename}</span> },
            {
              key: "status",
              label: "Status",
              render: (row) => <span className={`audit-status ${uploadTone(row.status)}`}>{humanize(row.status)}</span>
            },
            { key: "rowCount", label: "Rows", render: (row) => <span className="cell-number">{Number(row.rowCount || 0).toLocaleString()}</span> },
            { key: "metric", label: "Result", render: (row) => <span className="cell-number">{fileMetric(row)}</span> }
          ]}
          empty={loadingAnalytics ? "Loading uploads…" : "No uploads yet."}
        />
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Recent missing aliases</h2>
            <p>Names an upload could not match to a product.</p>
          </div>
          <button type="button" className="link-button" onClick={() => onOpen("missing")}>
            Resolve aliases <ChevronRight size={15} />
          </button>
        </div>
        <DataTable
          rows={recent.missingAliases || []}
          columns={[
            { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
            { key: "product", label: "Alias", render: (row) => <span className="cell-file">{row.product}</span> },
            // The full session UUID repeated down every row was a column of
            // identical noise; the short form still identifies the batch.
            { key: "sessionKey", label: "Session", render: (row) => <code className="cell-id" title={row.sessionKey}>{shortId(row.sessionKey)}</code> }
          ]}
          empty={loadingAnalytics ? "Loading missing aliases…" : "No missing aliases found."}
        />
      </section>

      <PanelOptions onOpen={onOpen} />
    </section>
  );
}

function Network({ companies, distributors, onDone, onNotice }) {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [distributor, setDistributor] = useState({
    companyId: "",
    did: "",
    dname: "",
    area: "",
    subarea: "",
    cell: "",
    status: true
  });
  const [busy, setBusy] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [distributorModalOpen, setDistributorModalOpen] = useState(false);

  const filteredDistributors = distributors
    .filter((item) => !companyFilter || item.companyId === companyFilter)
    .filter((item) => {
      const needle = query.toLowerCase();
      if (!needle) return true;
      return [item.dname, item.area, item.subarea, item.cell, item.company?.cname]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    })
    .slice(0, 250);

  async function addCompany(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.createCompany({ cname: companyName });
      setCompanyName("");
      setDistributor((current) => ({ ...current, companyId: created.id }));
      setCompanyModalOpen(false);
      onNotice({ type: "success", message: "Company added." });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function addDistributor(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createDistributor(distributor);
      setDistributor({
        companyId: distributor.companyId,
        did: "",
        dname: "",
        area: "",
        subarea: "",
        cell: "",
        status: true
      });
      setDistributorModalOpen(false);
      onNotice({ type: "success", message: "Distributor added." });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen-grid">
      <div className="toolbar">
        <Field label="Search">
          <div className="search-box">
            <Search size={17} />
            <input type="search" aria-label="Search distributors" value={query} placeholder="Search distributors" onChange={(event) => setQuery(event.target.value)} />
          </div>
        </Field>
        <Field label="Company">
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            <option value="">All companies</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.cname}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <section className="panel wide">
        <PanelHeading
          title="Distributors"
          action={(
            <button type="button" className="panel-action" onClick={() => setDistributorModalOpen(true)}>
              <Plus size={16} />
              Add distributor
            </button>
          )}
        />
        <DataTable
          rows={filteredDistributors}
          columns={[
            { key: "dname", label: "Distributor" },
            { key: "company", label: "Company", render: (row) => row.company?.cname || "" },
            { key: "area", label: "Area" },
            { key: "subarea", label: "Subarea" },
            { key: "cell", label: "Cell" },
            { key: "status", label: "Status", render: (row) => (row.status ? "Active" : "Inactive") }
          ]}
        />
      </section>

      <section className="panel wide">
        <PanelHeading
          title="Companies"
          action={(
            <button type="button" className="panel-action" onClick={() => setCompanyModalOpen(true)}>
              <Plus size={16} />
              Add company
            </button>
          )}
        />
        <DataTable
          rows={companies}
          columns={[
            { key: "cname", label: "Company" },
            {
              key: "distributors",
              label: "Distributors",
              render: (row) => distributors.filter((item) => item.companyId === row.id).length
            }
          ]}
        />
      </section>

      <Modal
        open={companyModalOpen}
        title="Add company"
        description="Create a company to group its distributors."
        onClose={() => setCompanyModalOpen(false)}
        size="small"
      >
        <form className="modal-form" onSubmit={addCompany}>
          <Field label="Company name">
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
          </Field>
          <footer className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => setCompanyModalOpen(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !companyName.trim()}>
              {busy ? <span className="button-spinner" aria-hidden="true" /> : <Plus size={18} />}
              {busy ? "Adding…" : "Add company"}
            </button>
          </footer>
        </form>
      </Modal>

      <Modal
        open={distributorModalOpen}
        title="Add distributor"
        description="Register a distributor against one of your companies."
        onClose={() => setDistributorModalOpen(false)}
      >
        <form className="modal-form" onSubmit={addDistributor}>
        <div className="form-grid">
          <Field label="Company">
            <select
              value={distributor.companyId}
              onChange={(event) => setDistributor({ ...distributor, companyId: event.target.value })}
              required
            >
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.cname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Distributor ID">
            <input
              type="number"
              min="1"
              value={distributor.did}
              onChange={(event) => setDistributor({ ...distributor, did: event.target.value })}
            />
          </Field>
          <Field label="Name">
            <input
              value={distributor.dname}
              onChange={(event) => setDistributor({ ...distributor, dname: event.target.value })}
              required
            />
          </Field>
          <Field label="Area">
            <input value={distributor.area} onChange={(event) => setDistributor({ ...distributor, area: event.target.value })} />
          </Field>
          <Field label="Subarea">
            <input value={distributor.subarea} onChange={(event) => setDistributor({ ...distributor, subarea: event.target.value })} />
          </Field>
          <Field label="Cell">
            <input value={distributor.cell} onChange={(event) => setDistributor({ ...distributor, cell: event.target.value })} />
          </Field>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={distributor.status}
            onChange={(event) => setDistributor({ ...distributor, status: event.target.checked })}
          />
          <span>Active distributor</span>
        </label>
          <footer className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => setDistributorModalOpen(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !distributor.companyId || !distributor.dname.trim()}>
              {busy ? <span className="button-spinner" aria-hidden="true" /> : <Plus size={18} />}
              {busy ? "Adding…" : "Add distributor"}
            </button>
          </footer>
        </form>
      </Modal>
    </section>
  );
}

function SsrUpload({ companies, distributors, products, onDone, onNotice }) {
  const [companyId, setCompanyId] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [aliasProducts, setAliasProducts] = useState({});
  const [savingAlias, setSavingAlias] = useState("");

  const availableDistributors = useMemo(
    () => distributors.filter((item) => !companyId || item.companyId === companyId),
    [companyId, distributors]
  );

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await api.uploadSsr({ file, distributorId, month, year });
      setResult(response);
      if (response.status === "missing-aliases") {
        onNotice({ type: "warn", message: `${response.missingAliases.length} missing aliases found.` });
      } else {
        onNotice({ type: "success", message: `${response.inserted} SSR rows processed.` });
      }
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function downloadMissingAliases() {
    if (!file) return;
    try {
      await api.downloadMissingAliases({ file });
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    }
  }

  async function saveMissingAlias(missing) {
    const productId = aliasProducts[missing];
    if (!productId) {
      onNotice({ type: "error", message: "Select a product before saving the alias." });
      return;
    }

    setSavingAlias(missing);
    try {
      await api.addMissingAlias({ productId, missing });
      setResult((current) => {
        if (current?.status !== "missing-aliases") return current;
        const missingAliases = current.missingAliases.filter((item) => item !== missing);
        return {
          ...current,
          missingAliases,
          status: missingAliases.length ? "missing-aliases" : "aliases-resolved"
        };
      });
      setAliasProducts((current) => {
        const next = { ...current };
        delete next[missing];
        return next;
      });
      onNotice({ type: "success", message: "Missing alias saved." });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setSavingAlias("");
    }
  }

  return (
    <section className="screen-grid two">
      <form className="panel" onSubmit={submit}>
        <div className="panel-heading">
          <h2>SSR File</h2>
        </div>
        <div className="form-grid">
          <Field label="Company">
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.cname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Distributor">
            <select value={distributorId} onChange={(event) => setDistributorId(event.target.value)} required>
              <option value="">Select distributor</option>
              {availableDistributors.map((distributor) => (
                <option key={distributor.id} value={distributor.id}>
                  {distributor.dname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Month">
            <select value={month} onChange={(event) => setMonth(event.target.value)} required>
              {months.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Year">
            <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} />
          </Field>
          <FileField label="Excel file" onChange={setFile} />
        </div>
        <button type="submit" className="primary-button" disabled={busy || !file || !distributorId}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <UploadCloud size={18} />}
          {busy ? "Processing…" : "Process SSR"}
        </button>
      </form>

      <section className="panel">
        <div className="panel-heading">
          <h2>Result</h2>
        </div>
        {result?.status === "processed" && (
          <div className="result-box success">
            <CheckCircle2 size={22} />
            <strong>{result.inserted} rows saved</strong>
            <span>Seg base total: {currency(result.segBaseTotal)}</span>
          </div>
        )}
        {result?.status === "missing-aliases" && (
          <div className="missing-alias-workflow">
            <div className="result-actions">
              <span>{result.missingAliases.length} missing aliases found</span>
              <button type="button" className="ghost-button" onClick={downloadMissingAliases}>
                <Download size={18} />
                Download
              </button>
            </div>
            <div className="missing-alias-list">
              {result.missingAliases.map((missing) => (
                <div className="missing-alias-item" key={missing}>
                  <strong>{missing}</strong>
                  <select
                    value={aliasProducts[missing] || ""}
                    onChange={(event) => setAliasProducts((current) => ({ ...current, [missing]: event.target.value }))}
                  >
                    <option value="">Select product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.pname}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={savingAlias === missing || !aliasProducts[missing]}
                    onClick={() => saveMissingAlias(missing)}
                  >
                    {savingAlias === missing ? <span className="button-spinner" aria-hidden="true" /> : <Plus size={18} />}
                    {savingAlias === missing ? "Saving…" : "Save Alias"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {result?.status === "aliases-resolved" && (
          <div className="result-box success">
            <CheckCircle2 size={22} />
            <strong>All missing aliases saved</strong>
            <span>Process the same SSR file again to save sales rows.</span>
          </div>
        )}
        {!result && <div className="empty-state">No upload result yet.</div>}
      </section>
    </section>
  );
}

function CheckData({ onNotice }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.checkSsr({ file });
      setResult(response);
      onNotice({
        type: response.missingAliases.length ? "warn" : "success",
        message: response.missingAliases.length ? `${response.missingAliases.length} missing aliases found.` : "No missing product found."
      });
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      await api.downloadMissingAliases({ file });
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    }
  }

  return (
    <section className="screen-grid two">
      <form className="panel" onSubmit={check}>
        <div className="panel-heading">
          <h2>Alias Check</h2>
        </div>
        <FileField label="Excel file" onChange={setFile} />
        <div className="button-row">
          <button type="submit" className="primary-button" disabled={busy || !file}>
            {busy ? <span className="button-spinner" aria-hidden="true" /> : <ClipboardCheck size={18} />}
            {busy ? "Checking…" : "Check"}
          </button>
          <button type="button" className="ghost-button" disabled={!file} onClick={download}>
            <Download size={18} />
            Download
          </button>
        </div>
      </form>
      <section className="panel">
        <div className="panel-heading">
          <h2>Missing Aliases</h2>
        </div>
        <DataTable
          rows={(result?.missingAliases || []).map((item) => ({ id: item, product: item }))}
          columns={[{ key: "product", label: "Alias" }]}
          empty="No checked aliases yet."
        />
      </section>
    </section>
  );
}

function Products({ companies, products, onDone, onNotice }) {
  const [query, setQuery] = useState("");
  const [newProduct, setNewProduct] = useState({ companyId: "", pname: "", ptype: "Retail" });
  const [companyImport, setCompanyImport] = useState({ companyId: "", ptype: "Retail", file: null });
  const [aliasImport, setAliasImport] = useState({ productId: "", file: null });
  const [busy, setBusy] = useState(false);

  const filteredProducts = products.filter((product) => product.pname.toLowerCase().includes(query.toLowerCase())).slice(0, 250);

  async function addProduct(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createProduct(newProduct);
      setNewProduct({ companyId: newProduct.companyId, pname: "", ptype: newProduct.ptype });
      onNotice({ type: "success", message: "Product added." });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function importProducts(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.importCompanyProducts(companyImport);
      onNotice({ type: "success", message: `${result.created} products imported, ${result.skipped || 0} skipped.` });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function importAliases(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.importProductAliases(aliasImport);
      onNotice({ type: "success", message: `${result.created} aliases imported, ${result.skipped} skipped.` });
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen-grid">
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input type="search" aria-label="Search products" value={query} placeholder="Search products" onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Product List</h2>
        </div>
        <DataTable
          rows={filteredProducts}
          columns={[
            { key: "pname", label: "Product" },
            { key: "ptype", label: "Type" },
            { key: "company", label: "Company", render: (row) => row.company?.cname || "" }
          ]}
        />
      </section>

      <form className="panel" onSubmit={addProduct}>
        <div className="panel-heading">
          <h2>Add Product</h2>
        </div>
        <Field label="Company">
          <select value={newProduct.companyId} onChange={(event) => setNewProduct({ ...newProduct, companyId: event.target.value })}>
            <option value="">No company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.cname}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input value={newProduct.pname} onChange={(event) => setNewProduct({ ...newProduct, pname: event.target.value })} required />
        </Field>
        <Field label="Type">
          <select value={newProduct.ptype} onChange={(event) => setNewProduct({ ...newProduct, ptype: event.target.value })}>
            <option value="Retail">Retail</option>
            <option value="Trade">Trade</option>
          </select>
        </Field>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !newProduct.pname.trim()}
        >
          <Plus size={18} />
          Add
        </button>
      </form>

      <form className="panel" onSubmit={importProducts}>
        <div className="panel-heading">
          <h2>Import Products</h2>
        </div>
        <Field label="Company">
          <select
            value={companyImport.companyId}
            onChange={(event) => setCompanyImport({ ...companyImport, companyId: event.target.value })}
            required
          >
            <option value="">Select company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.cname}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select value={companyImport.ptype} onChange={(event) => setCompanyImport({ ...companyImport, ptype: event.target.value })}>
            <option value="Retail">Retail</option>
            <option value="Trade">Trade</option>
          </select>
        </Field>
        <FileField label="Excel file" onChange={(file) => setCompanyImport({ ...companyImport, file })} />
        <button type="submit" className="primary-button" disabled={busy || !companyImport.file}>
          <UploadCloud size={18} />
          Import
        </button>
      </form>

      <form className="panel" onSubmit={importAliases}>
        <div className="panel-heading">
          <h2>Import Aliases</h2>
        </div>
        <Field label="Product">
          <select value={aliasImport.productId} onChange={(event) => setAliasImport({ ...aliasImport, productId: event.target.value })} required>
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.pname}
              </option>
            ))}
          </select>
        </Field>
        <FileField label="Excel file" onChange={(file) => setAliasImport({ ...aliasImport, file })} />
        <button type="submit" className="primary-button" disabled={busy || !aliasImport.file || !aliasImport.productId}>
          <UploadCloud size={18} />
          Import
        </button>
      </form>
    </section>
  );
}

function Schemes({ onNotice }) {
  const [file, setFile] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [busy, setBusy] = useState(false);

  async function loadSchemes() {
    setSchemes(await api.schemes({ limit: 250 }));
  }

  useEffect(() => {
    loadSchemes().catch((error) => onNotice({ type: "error", message: error.message }));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.importSchemes({ file });
      onNotice({
        type: result.missingProducts.length ? "warn" : "success",
        message: `${result.created} schemes imported. Missing products: ${result.missingProducts.length}.`
      });
      await loadSchemes();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen-grid two">
      <form className="panel" onSubmit={submit}>
        <div className="panel-heading">
          <h2>Scheme Import</h2>
        </div>
        <FileField label="Excel file" onChange={setFile} />
        <button type="submit" className="primary-button" disabled={busy || !file}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <UploadCloud size={18} />}
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Current Schemes</h2>
        </div>
        <DataTable
          rows={schemes}
          columns={[
            { key: "product", label: "Product", render: (row) => row.product?.pname || "" },
            { key: "schemeid", label: "Scheme" },
            { key: "basepolicy", label: "Base" },
            { key: "bonuspolicy", label: "Bonus" },
            { key: "tp", label: "TP", render: (row) => currency(row.tp) }
          ]}
        />
      </section>
    </section>
  );
}

function MissingAliases({ products, onDone, onNotice }) {
  const [missing, setMissing] = useState([]);
  const [form, setForm] = useState({ productId: "", missing: "" });
  const [busy, setBusy] = useState(false);

  async function loadMissing() {
    setMissing(await api.missingAliases());
  }

  useEffect(() => {
    loadMissing().catch((error) => onNotice({ type: "error", message: error.message }));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!form.productId) {
      onNotice({ type: "error", message: "Select the product this alias belongs to." });
      return;
    }
    if (!form.missing.trim()) {
      onNotice({ type: "error", message: "Enter the alias text to add." });
      return;
    }
    setBusy(true);
    try {
      await api.addMissingAlias(form);
      setForm({ ...form, missing: "" });
      onNotice({ type: "success", message: "Missing alias added." });
      await loadMissing();
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen-grid two">
      <form className="panel" onSubmit={submit}>
        <div className="panel-heading">
          <h2>Save Product Alias</h2>
        </div>
        <Field label="Product">
          <select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} required>
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.pname}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Missing alias">
          <input value={form.missing} onChange={(event) => setForm({ ...form, missing: event.target.value })} required />
        </Field>
        <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
          <Plus size={18} />
          Add Alias
        </button>
      </form>

      <section className="panel">
        <div className="panel-heading">
          <h2>Detected Missing</h2>
        </div>
        <DataTable
          rows={missing}
          columns={[
            {
              key: "product",
              label: "Alias",
              render: (row) => (
                <button type="button" className="link-button" onClick={() => setForm({ ...form, missing: row.product })}>
                  {row.product}
                </button>
              )
            }
          ]}
        />
      </section>
    </section>
  );
}

function OtherServices({ onDone, onNotice }) {
  const [query, setQuery] = useState("");
  const [services, setServices] = useState([]);
  const [form, setForm] = useState({
    name: "",
    category: "Other",
    description: "",
    price: "",
    status: true
  });
  const [busy, setBusy] = useState(false);

  async function loadServices() {
    setServices(await api.services({ limit: 600 }));
  }

  useEffect(() => {
    loadServices().catch((error) => onNotice({ type: "error", message: error.message }));
  }, []);

  const filteredServices = services
    .filter((service) => {
      const needle = query.toLowerCase();
      if (!needle) return true;
      return [service.name, service.category, service.description]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    })
    .slice(0, 250);

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      onNotice({ type: "error", message: "Enter a service name before adding it." });
      return;
    }
    setBusy(true);
    try {
      await api.createService(form);
      setForm({ name: "", category: form.category, description: "", price: "", status: true });
      onNotice({ type: "success", message: "Service added." });
      await loadServices();
      await onDone();
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen-grid">
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input type="search" aria-label="Search services" value={query} placeholder="Search services" onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Service List</h2>
        </div>
        <DataTable
          rows={filteredServices}
          columns={[
            { key: "name", label: "Service" },
            { key: "category", label: "Category" },
            { key: "description", label: "Description" },
            { key: "price", label: "Price", render: (row) => currency(row.price) },
            { key: "status", label: "Status", render: (row) => (row.status ? "Active" : "Inactive") }
          ]}
        />
      </section>

      <form className="panel wide" onSubmit={submit}>
        <div className="panel-heading">
          <h2>Add Service</h2>
        </div>
        <div className="form-grid">
          <Field label="Service name">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <Field label="Category">
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </Field>
          <Field label="Price">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
          </Field>
          <label className="checkbox-field service-status">
            <input
              type="checkbox"
              checked={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.checked })}
            />
            <span>Active service</span>
          </label>
        </div>
        <Field label="Description">
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows="3" />
        </Field>
        <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
          <Plus size={18} />
          Add Service
        </button>
      </form>
    </section>
  );
}

function Summary({ onNotice }) {
  const [month, setMonth] = useState(currentMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [periods, setPeriods] = useState([]);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadRequest = useRef(0);

  async function load(event, selectedMonth = month, selectedYear = year) {
    event?.preventDefault();
    const requestId = ++loadRequest.current;
    setBusy(true);
    try {
      const nextSummary = await api.summary(selectedMonth, selectedYear);
      if (requestId === loadRequest.current) setSummary(nextSummary);
    } catch (error) {
      if (requestId === loadRequest.current) onNotice({ type: "error", message: error.message });
    } finally {
      if (requestId === loadRequest.current) setBusy(false);
    }
  }

  useEffect(() => {
    async function loadInitialSummary() {
      const requestId = ++loadRequest.current;
      setBusy(true);
      try {
        const [availablePeriods, latest] = await Promise.all([
          api.summaryPeriods(),
          api.latestSummaryPeriod()
        ]);
        if (requestId !== loadRequest.current) return;
        const selectedMonth = latest.year ? "all" : currentMonth();
        const selectedYear = latest.year || new Date().getFullYear();
        setPeriods(availablePeriods);
        setMonth(selectedMonth);
        setYear(selectedYear);
        const initialSummary = await api.summary(selectedMonth, selectedYear);
        if (requestId === loadRequest.current) setSummary(initialSummary);
      } catch (error) {
        if (requestId === loadRequest.current) onNotice({ type: "error", message: error.message });
      } finally {
        if (requestId === loadRequest.current) setBusy(false);
      }
    }

    loadInitialSummary();
    return () => {
      loadRequest.current += 1;
    };
  }, []);

  const sizaRows = summary?.siza_problematic_distributors || summary?.Siza_problematic_distributors || [];
  const razeeRows = summary?.raazee_problematic_distributors || summary?.Raze_problematic_distributors || [];
  const problemCount =
    (summary?.siza_problematic ?? summary?.siza_problamatic ?? 0) +
    (summary?.raazee_problematic ?? summary?.raze_problamatic ?? 0);
  const selectedPeriodKey = `${month}-${year}`;
  const availablePeriod = periods.find((period) => `${period.month}-${period.year}` === selectedPeriodKey);
  const availableMonthsForYear = new Set(
    periods
      .filter((period) => Number(period.year) === Number(year))
      .map((period) => period.month)
  );
  const selectableMonths = periods.length
    ? months.filter((item) => availableMonthsForYear.has(item))
    : months;

  function selectPeriod(nextMonth, nextYear) {
    const normalizedYear = Number(nextYear);
    setMonth(nextMonth);
    setYear(nextYear);
    if (Number.isInteger(normalizedYear) && normalizedYear >= 2000 && normalizedYear <= 2100) {
      setYear(normalizedYear);
      load(undefined, nextMonth, normalizedYear);
    }
  }

  return (
    <section className="screen-grid">
      <form className="toolbar" onSubmit={load}>
        <Field label="Available Period">
          <select
            value={availablePeriod ? selectedPeriodKey : ""}
            onChange={(event) => {
              const [nextMonth, nextYear] = event.target.value.split("-");
              if (nextMonth && nextYear) selectPeriod(nextMonth, nextYear);
            }}
          >
            <option value="">Manual month/year</option>
            {periods.map((period) => (
              <option key={`${period.month}-${period.year}`} value={`${period.month}-${period.year}`}>
                {period.month.toUpperCase()} {period.year} ({Number(period.count || 0).toLocaleString()} rows)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Month">
          <select value={month} onChange={(event) => selectPeriod(event.target.value, year)}>
            <option value="all">ALL MONTHS</option>
            {selectableMonths.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year">
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onFocus={() => setMonth("all")}
            onChange={(event) => {
              const nextYear = event.target.value;
              setYear(nextYear);
              setMonth("all");
              if (/^\d{4}$/.test(nextYear)) selectPeriod("all", nextYear);
            }}
            onBlur={(event) => {
              if (/^\d{4}$/.test(event.target.value)) selectPeriod("all", event.target.value);
            }}
          />
        </Field>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <RefreshCw size={18} />}
          {busy ? "Loading…" : "Load Period"}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={busy || !/^\d{4}$/.test(String(year)) || Number(year) < 2000 || Number(year) > 2100}
          onClick={() => selectPeriod("all", year)}
        >
          Full Year
        </button>
      </form>

      {summary && (
        <div className="summary-period-status">
          <span>Showing summary for</span>
          <strong>{summary.month === "all" ? "ALL MONTHS" : String(summary.month || month).toUpperCase()} {summary.year || year}</strong>
          <small>{Number(summary.row_count ?? availablePeriod?.count ?? 0).toLocaleString()} sales rows</small>
        </div>
      )}

      {summary && (
        <div className="stat-grid">
          <StatCard icon={FileSpreadsheet} label="Total SSR" value={summary.ssr} />
          <StatCard icon={Building2} label="Siza SSR" value={summary.siza} />
          <StatCard icon={Building2} label="Raazee SSR" value={summary.razee} />
          <StatCard icon={CheckCircle2} label="Siza Quality" value={summary.quality_assured} tone="green" />
          <StatCard icon={CheckCircle2} label="Raazee Quality" value={summary.quality_raazee ?? summary.quality_raze} tone="green" />
          <StatCard icon={AlertTriangle} label="Problems" value={problemCount} tone="rose" />
        </div>
      )}

      {summary && summary.ssr === 0 && (
        <section className="panel wide">
          <div className="empty-state">
            No SSR sales found for {summary.month === "all" ? "ALL MONTHS" : String(summary.month || month).toUpperCase()} {summary.year || year}.
            {periods.length ? ` Available periods: ${periods.map((period) => `${period.month.toUpperCase()} ${period.year}`).join(", ")}.` : ""}
          </div>
        </section>
      )}

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Siza Problematic</h2>
        </div>
        <ProblemTable rows={sizaRows} />
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Raazee Problematic</h2>
        </div>
        <ProblemTable rows={razeeRows} />
      </section>
    </section>
  );
}

function ProblemTable({ rows }) {
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: "company", label: "Company" },
        { key: "area", label: "Area" },
        { key: "distributor", label: "Distributor" },
        { key: "total_clvalue", label: "CL Value", render: (row) => currency(row.total_clvalue) },
        { key: "total_segvalue", label: "SEG Value", render: (row) => currency(row.total_segvalue) },
        { key: "difference", label: "Difference", render: (row) => currency(row.difference) }
      ]}
    />
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

function GoogleSignInButton({ label = "Continue with Google" }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
      // The browser navigates away to Google here; nothing after this runs
      // unless something stopped the redirect before it happened.
    } catch (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  return (
    <div className="oauth-block">
      <div className="auth-divider"><span>or</span></div>
      <button type="button" className="oauth-button" onClick={start} disabled={busy}>
        {busy ? <span className="button-spinner" aria-hidden="true" /> : <GoogleGlyph />}
        {busy ? "Redirecting…" : label}
      </button>
      {error && (
        <div className="login-error" role="alert">
          <XCircle size={17} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function AuthNav() {
  const { pathname } = useLocation();
  return (
    <nav className="auth-nav">
      {pathname !== "/" && <Link className="auth-nav-link" to="/">Home</Link>}
      {pathname !== "/login" && <Link className="auth-nav-link" to="/login">Sign in</Link>}
      {pathname !== "/signup" && <Link className="auth-nav-cta" to="/signup">Create account</Link>}
    </nav>
  );
}

function AuthLayout({ title, subtitle, children }) {
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <Link className="auth-aside-brand" to="/">
          <span className="auth-brand-mark">SSR</span>
          <span className="auth-brand-text">
            <strong>Sales Stock Report</strong>
            <small>Sales, Stock &amp; Reporting</small>
          </span>
        </Link>
        <div className="auth-aside-copy">
          <span className="auth-eyebrow">Distribution operations platform</span>
          <div className="auth-aside-headline">Close the month on numbers you can defend.</div>
          <p>Sales, stock, distributor and reporting operations in one dependable workspace.</p>
        </div>
        <ul className="auth-aside-points">
          <li>Excel SSR processing</li>
          <li>One distributor network</li>
          <li>Reporting you can sign off</li>
        </ul>
      </aside>
      <section className="auth-panel">
        <AuthNav />
        <div className="auth-card">
          <Link className="auth-card-brand" to="/">
            <span className="auth-brand-mark">SSR</span>
            <strong>Sales Stock Report</strong>
          </Link>
          <header className="auth-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>
          {children}
        </div>
        <footer className="auth-footer">
          <span className="auth-secure">
            <ShieldCheck size={13} />
            Encrypted connection &middot; Audit-logged sessions
          </span>
          <span>&copy; {new Date().getFullYear()} Sales Stock Report</span>
        </footer>
      </section>
    </main>
  );
}

const landingFeatures = [
  {
    icon: FileSpreadsheet,
    title: "Excel SSR processing",
    body: "Drop in a distributor workbook and closing stock, sale units and scheme segregation are computed on upload — no second reconciliation pass by hand."
  },
  {
    icon: Users,
    title: "One distributor network",
    body: "Companies, distributors, products and aliases stay reconciled in one place. Names that do not match are surfaced for review rather than silently dropped."
  },
  {
    icon: ClipboardCheck,
    title: "Reporting you can sign off",
    body: "Month-end summaries carry their own quality checks, export straight to Excel, and stay traceable through the audit log."
  }
];

const landingSteps = [
  { icon: UploadCloud, title: "Upload", body: "Bring in SSR workbooks, product masters and scheme sheets." },
  { icon: Layers3, title: "Reconcile", body: "Aliases resolve against your catalogue and exceptions get flagged, not buried." },
  { icon: BarChart3, title: "Report", body: "Monthly summaries and exports, scoped to your own tenant." }
];

// Illustrative only, so it stays out of the accessibility tree: the point is
// to show the shape of the output, not to be read out as data.
function LandingPreview() {
  const bars = [52, 67, 44, 81, 59, 73, 91];
  return (
    <div className="landing-preview" aria-hidden="true">
      <div className="landing-preview-card">
        <header className="landing-preview-head">
          <span className="landing-preview-dot" />
          <strong>Monthly summary</strong>
          <span className="landing-preview-tag">Verified</span>
        </header>
        <div className="landing-preview-stats">
          <div><span>Total SSR</span><strong>17,392</strong></div>
          <div><span>Distributors</span><strong>442</strong></div>
          <div><span>Exceptions</span><strong className="is-ok">0</strong></div>
        </div>
        <div className="landing-preview-chart">
          {bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
        </div>
        <footer className="landing-preview-foot">
          <CheckCircle2 size={14} />
          <span>Quality checks passed &middot; audit logged</span>
        </footer>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="landing-page">
      <Navbar />
      <main>
        <section className="landing-shell landing-hero">
          <div className="landing-copy">
            <span className="landing-eyebrow">Distribution operations platform</span>
            <h1>Close the month on numbers you can defend.</h1>
            <p>
              Sales Stock Report turns distributor spreadsheets into reconciled,
              audit-ready reporting — without the manual passes that make month-end slip.
            </p>
            <div className="landing-actions">
              <Link className="primary-link" to="/signup">Get started<ChevronRight size={17} /></Link>
              <a className="ghost-link" href="#how-it-works">See how it works</a>
            </div>
            <p className="landing-trust">
              <ShieldCheck size={15} />
              Encrypted connection &middot; Audit-logged sessions &middot; Tenant-isolated data
            </p>
          </div>
          <LandingPreview />
        </section>

        <section className="landing-shell landing-section" id="features">
          <div className="landing-section-head">
            <span className="landing-eyebrow">What it does</span>
            <h2>Built for the work that actually eats the month.</h2>
          </div>
          <div className="landing-features">
            {landingFeatures.map(({ icon: Icon, title, body }) => (
              <article className="landing-feature" key={title}>
                <span className="landing-feature-icon"><Icon size={19} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-shell landing-section" id="how-it-works">
          <div className="landing-section-head">
            <span className="landing-eyebrow">How it works</span>
            <h2>Three steps from workbook to signed-off report.</h2>
          </div>
          <ol className="landing-steps">
            {landingSteps.map(({ icon: Icon, title, body }, index) => (
              <li key={title}>
                <span className="landing-step-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="landing-step-icon"><Icon size={18} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-shell">
          <div className="landing-cta">
            <h2>Ready to close the month properly?</h2>
            <p>Create an account and process your first SSR workbook in minutes.</p>
            <div className="landing-actions">
              <Link className="primary-link" to="/signup">Create account<ChevronRight size={17} /></Link>
              <Link className="ghost-link" to="/login">Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-shell landing-footer">
        <span>Sales Stock Report &mdash; sales, stock &amp; reporting</span>
        <span>&copy; {new Date().getFullYear()} Sales Stock Report</span>
      </footer>
    </div>
  );
}

function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "", remember: true });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which field the message belongs to, so only that one is marked invalid.
  // A rejected sign-in blames neither: the server does not say which half was
  // wrong, and guessing would leak which usernames exist.
  const [errorField, setErrorField] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setErrorField(null);
    if (!form.username.trim()) {
      setError("Enter your username to continue.");
      setErrorField("username");
      return;
    }
    if (!form.password) {
      setError("Enter your password to continue.");
      setErrorField("password");
      return;
    }
    setBusy(true);
    try {
      await login(form);
      navigate(location.state?.from?.pathname || "/app", { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  if (isAuthenticated) return <Navigate to="/app" replace />;

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your workspace">
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Username">
          <div className="input-affix">
            <User className="input-affix-icon" size={17} />
            <input
              name="username"
              value={form.username}
              placeholder="your.username"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              aria-invalid={errorField === "username" ? "true" : undefined}
              aria-describedby={error ? "login-error" : undefined}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </div>
        </Field>
        <Field label="Password">
          <div className="input-affix password-input">
            <LockKeyhole className="input-affix-icon" size={17} />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              placeholder="••••••••"
              autoComplete="current-password"
              aria-invalid={errorField === "password" ? "true" : undefined}
              aria-describedby={error ? "login-error" : undefined}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
            <button
              type="button"
              className="password-toggle"
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        <div className="auth-options">
          <label className="remember-control">
            <input type="checkbox" checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} />
            <span>Remember me</span>
          </label>
          <Link className="auth-link" to="/forgot-password">Forgot password?</Link>
        </div>
        {error && (
          <div className="login-error" id="login-error" role="alert">
            <XCircle size={17} />
            <span>{error}</span>
          </div>
        )}
        {/* Only the in-flight request disables this. Gating it on empty fields
            hid the reason it was inert and left the checks above unreachable. */}
        <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <LockKeyhole size={18} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="auth-switch">
          New here? <Link className="auth-link" to="/signup">Create an account</Link>
        </p>
      </form>
      <GoogleSignInButton label="Sign in with Google" />
    </AuthLayout>
  );
}

function SignupPage() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  function fail(field, message) {
    setErrorField(field);
    setError(message);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setErrorField(null);
    if (!form.name.trim()) return fail("name", "Enter your name to continue.");
    if (!form.email.trim()) return fail("email", "Enter your email address.");
    if (form.password.length < 6) return fail("password", "Use at least 6 characters for your password.");
    if (form.password !== form.confirmPassword) return fail("confirmPassword", "Password and confirmation do not match.");
    setBusy(true);
    try {
      const result = await signup(form);
      if (result.needsConfirmation) {
        setNeedsConfirmation(true);
      } else {
        navigate("/app", { replace: true });
      }
    } catch (signupError) {
      setError(signupError.message);
    } finally {
      setBusy(false);
    }
  }

  if (isAuthenticated) return <Navigate to="/app" replace />;

  if (needsConfirmation) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step to activate your workspace">
        <div className="auth-form">
          <div className="login-success">
            <MailCheck size={18} /> We sent a confirmation link to {form.email}.
          </div>
          <p className="auth-reset-intro">
            Open it to activate your account and sign in. The link expires after a while, so check your
            spam folder if it does not arrive within a few minutes.
          </p>
          <button type="button" className="primary-button" onClick={() => navigate("/login")}>
            Back to sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create account" subtitle="Start a protected workspace">
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Name">
          <div className="input-affix">
            <User className="input-affix-icon" size={17} />
            <input
              name="name"
              value={form.name}
              placeholder="Your full name"
              autoComplete="name"
              autoFocus
              aria-invalid={errorField === "name" ? "true" : undefined}
              aria-describedby={error ? "signup-error" : undefined}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
        </Field>
        <Field label="Email">
          <div className="input-affix">
            <AtSign className="input-affix-icon" size={17} />
            <input
              name="email"
              type="email"
              value={form.email}
              placeholder="you@company.com"
              autoComplete="email"
              spellCheck={false}
              aria-invalid={errorField === "email" ? "true" : undefined}
              aria-describedby={error ? "signup-error" : undefined}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          </div>
        </Field>
        <Field label="Password">
          <div className="input-affix password-input">
            <LockKeyhole className="input-affix-icon" size={17} />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={6}
              value={form.password}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={errorField === "password" ? "true" : undefined}
              aria-describedby="signup-password-hint"
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
            <button type="button" className="password-toggle" title={showPassword ? "Hide password" : "Show password"} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <span className="auth-hint" id="signup-password-hint">At least 6 characters.</span>
        </Field>
        <Field label="Confirm password">
          <div className="input-affix password-input">
            <LockKeyhole className="input-affix-icon" size={17} />
            <input
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              minLength={6}
              value={form.confirmPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={errorField === "confirmPassword" ? "true" : undefined}
              aria-describedby={error ? "signup-error" : undefined}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
            />
            <button type="button" className="password-toggle" title={showPassword ? "Hide password" : "Show password"} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        {error && (
          <div className="login-error" id="signup-error" role="alert">
            <XCircle size={17} />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <User size={18} />}
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="auth-switch">
          Already have an account? <Link className="auth-link" to="/login">Sign in</Link>
        </p>
      </form>
      <GoogleSignInButton label="Sign up with Google" />
    </AuthLayout>
  );
}

function ForgotPasswordPage() {
  const [form, setForm] = useState({ username: "", recoveryCode: "", newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState(null);
  const [message, setMessage] = useState("");

  function fail(field, text) {
    setErrorField(field);
    setError(text);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setErrorField(null);
    setMessage("");
    if (!form.username.trim()) return fail("username", "Enter your username to continue.");
    if (!form.recoveryCode) return fail("recoveryCode", "Enter your administrator recovery code.");
    if (form.newPassword.length < 12) return fail("newPassword", "Use at least 12 characters for the new password.");
    if (form.newPassword !== form.confirmPassword) return fail("confirmPassword", "New password and confirmation do not match.");
    setBusy(true);
    try {
      const result = await api.resetPassword({
        username: form.username,
        recoveryCode: form.recoveryCode,
        newPassword: form.newPassword
      });
      setForm((current) => ({ ...current, recoveryCode: "", newPassword: "", confirmPassword: "" }));
      setMessage(result.message);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Password recovery" subtitle="Reset administrator access">
      <form className="auth-form" onSubmit={submit} noValidate>
        {message && (
          <div className="login-success" role="status">
            <CheckCircle2 size={17} />
            <span>{message}</span>
          </div>
        )}
        <p className="auth-reset-intro">Enter your administrator recovery code and choose a new password.</p>
        <Field label="Username">
          <div className="input-affix">
            <User className="input-affix-icon" size={17} />
            <input
              name="username"
              value={form.username}
              placeholder="your.username"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              aria-invalid={errorField === "username" ? "true" : undefined}
              aria-describedby={error ? "reset-error" : undefined}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />
          </div>
        </Field>
        <Field label="Recovery code">
          <div className="input-affix">
            <KeyRound className="input-affix-icon" size={17} />
            <input
              name="recoveryCode"
              type="password"
              value={form.recoveryCode}
              autoComplete="one-time-code"
              aria-invalid={errorField === "recoveryCode" ? "true" : undefined}
              aria-describedby={error ? "reset-error" : undefined}
              onChange={(event) => setForm({ ...form, recoveryCode: event.target.value })}
              required
            />
          </div>
        </Field>
        <Field label="New password">
          <div className="input-affix password-input">
            <LockKeyhole className="input-affix-icon" size={17} />
            <input
              name="newPassword"
              type={showPassword ? "text" : "password"}
              value={form.newPassword}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={12}
              aria-invalid={errorField === "newPassword" ? "true" : undefined}
              aria-describedby="reset-password-hint"
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              required
            />
            <button type="button" className="password-toggle" title={showPassword ? "Hide password" : "Show password"} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <span className="auth-hint" id="reset-password-hint">At least 12 characters.</span>
        </Field>
        <Field label="Confirm new password">
          <div className="input-affix">
            <LockKeyhole className="input-affix-icon" size={17} />
            <input
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={form.confirmPassword}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={12}
              aria-invalid={errorField === "confirmPassword" ? "true" : undefined}
              aria-describedby={error ? "reset-error" : undefined}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
            />
          </div>
        </Field>
        {error && (
          <div className="login-error" id="reset-error" role="alert">
            <XCircle size={17} />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <LockKeyhole size={18} />}
          {busy ? "Resetting password…" : "Reset password"}
        </button>
      </form>
    </AuthLayout>
  );
}

function ForgotPasswordRequestPage() {
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a secure link">
      <ForgotPasswordRequestForm />
    </AuthLayout>
  );
}

function ResetPasswordPage() {
  return (
    <AuthLayout title="Set a new password" subtitle="Choose a new password for your account">
      <ResetPasswordForm />
    </AuthLayout>
  );
}

function ConfirmEmailPage() {
  return (
    <AuthLayout title="Confirm your account" subtitle="Activating your workspace">
      <EmailConfirmForm />
    </AuthLayout>
  );
}

/**
 * Where Google (via Supabase) redirects back to. supabaseBrowser() was
 * created with detectSessionInUrl: true, so by the time this mounts it has
 * already parsed the callback and exchanged it for a session in memory; this
 * just reads that session and hands it to the server.
 */
function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { adoptOAuthSession } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error: sessionError } = await supabaseBrowser().auth.getSession();
        if (sessionError) throw new Error(sessionError.message);
        const session = data?.session;
        if (!session) throw new Error("Google sign-in did not complete. Please try again.");

        await adoptOAuthSession({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresIn: session.expires_in
        });
        // The server now owns the session via httpOnly cookies; this
        // in-memory client copy has done its job and is discarded.
        await supabaseBrowser().auth.signOut({ scope: "local" }).catch(() => {});

        if (!cancelled) navigate("/app", { replace: true });
      } catch (callbackError) {
        if (!cancelled) setError(callbackError.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptOAuthSession, navigate]);

  return (
    <AuthLayout title="Signing you in" subtitle="Finishing up with Google">
      <div className="auth-form">
        {error ? (
          <>
            <div className="login-error" role="alert">
              <XCircle size={17} />
              <span>{error}</span>
            </div>
            <button type="button" className="primary-button" onClick={() => navigate("/login")}>
              Back to sign in
            </button>
          </>
        ) : (
          <div className="login-success">
            <span className="button-spinner" aria-hidden="true" /> Completing sign-in…
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

function Profile({ onNotice, onLogout }) {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);
  const [view, setView] = useState("view");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [profileForm, setProfileForm] = useState({ name: user?.name || "", email: user?.email || "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [resending, setResending] = useState(false);

  async function resendConfirmation() {
    if (!user?.email) return;
    setResending(true);
    try {
      await api.resendConfirmation({ email: user.email });
      onNotice({ type: "success", message: "Confirmation email sent. Check your inbox." });
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setResending(false);
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.updateProfile(profileForm);
      await refreshUser();
      onNotice({ type: "success", message: "Profile updated successfully." });
      setView("view");
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        onNotice({ type: "error", message: "New passwords do not match." });
        return;
      }
      await api.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      onNotice({ type: "success", message: "Password changed successfully." });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setView("view");
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (deleteConfirm !== "DELETE") {
      onNotice({ type: "error", message: 'Please type "DELETE" to confirm.' });
      return;
    }
    setBusy(true);
    try {
      await api.deleteAccount();
      onNotice({ type: "success", message: "Account deleted successfully." });
      await onLogout();
      navigate("/", { replace: true });
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      onNotice({ type: "error", message: "Please select a valid image file." });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      onNotice({ type: "error", message: "Avatar image must be smaller than 5 MB." });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(String(reader.result || ""));
      onNotice({ type: "success", message: "Avatar preview updated." });
    };
    reader.readAsDataURL(file);
  }

  if (!user) {
    return (
      <section className="profile-page" aria-label="Loading profile">
        <section className="profile-shell profile-skeleton">
          <div className="profile-cover" />
          <div className="profile-header-content">
            <div className="skeleton-block profile-skeleton-avatar" />
            <div className="profile-skeleton-copy">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          </div>
          <div className="profile-content">
            <div className="skeleton-block profile-skeleton-title" />
            <div className="profile-info-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="profile-info-card" key={index}>
                  <div className="skeleton-block profile-skeleton-line" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    );
  }

  if (view === "edit") {
    return (
      <section className="screen-grid">
        <section className="panel wide">
          <div className="panel-heading">
            <h2>Edit Profile</h2>
          </div>
          <form className="profile-form" onSubmit={updateProfile}>
            <Field label="Name">
              <input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} required />
            </Field>
            <Field label="Email">
              <input type="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} required />
            </Field>
            <div className="button-row">
              <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
                {busy && <span className="button-spinner" aria-hidden="true" />}
                {busy ? "Saving…" : "Save Changes"}
              </button>
              <button type="button" className="ghost-button" onClick={() => setView("view")}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      </section>
    );
  }

  if (view === "password") {
    return (
      <section className="screen-grid">
        <section className="panel wide">
          <div className="panel-heading">
            <h2>Change Password</h2>
          </div>
          <form className="profile-form" onSubmit={changePassword}>
            <Field label="Current Password">
              <div className="password-input">
                <input type={showPasswords.current ? "text" : "password"} value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} required />
                <button type="button" className="password-toggle" title={showPasswords.current ? "Hide password" : "Show password"} aria-label={showPasswords.current ? "Hide password" : "Show password"} aria-pressed={showPasswords.current} onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}>
                  {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <Field label="New Password">
              <div className="password-input">
                <input type={showPasswords.new ? "text" : "password"} value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} required minLength={6} />
                <button type="button" className="password-toggle" title={showPasswords.new ? "Hide password" : "Show password"} aria-label={showPasswords.new ? "Hide password" : "Show password"} aria-pressed={showPasswords.new} onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}>
                  {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <Field label="Confirm New Password">
              <div className="password-input">
                <input type={showPasswords.confirm ? "text" : "password"} value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} required minLength={6} />
                <button type="button" className="password-toggle" title={showPasswords.confirm ? "Hide password" : "Show password"} aria-label={showPasswords.confirm ? "Hide password" : "Show password"} aria-pressed={showPasswords.confirm} onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}>
                  {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <div className="button-row">
              <button type="submit" className="primary-button" aria-busy={busy} disabled={busy}>
                {busy && <span className="button-spinner" aria-hidden="true" />}
                {busy ? "Changing…" : "Change Password"}
              </button>
              <button type="button" className="ghost-button" onClick={() => setView("view")}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      </section>
    );
  }

  if (view === "delete") {
    return (
      <section className="screen-grid">
        <section className="panel wide">
          <div className="panel-heading">
            <h2>Delete Account</h2>
          </div>
          <div className="danger-zone">
            <AlertTriangle size={48} />
            <h3>This action cannot be undone</h3>
            <p>All your data will be permanently deleted. This includes your profile, settings, and associated records.</p>
            <Field label="Type DELETE to confirm">
              <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" />
            </Field>
            <div className="button-row">
              <button type="button" className="danger-button" onClick={deleteAccount} disabled={busy || deleteConfirm !== "DELETE"}>
                {busy ? <span className="button-spinner" aria-hidden="true" /> : <Trash2 size={18} />}
                {busy ? "Deleting…" : "Delete Account"}
              </button>
              <button type="button" className="ghost-button" onClick={() => { setDeleteConfirm(""); setView("view"); }}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <section className="profile-shell">
        <div className="profile-cover" />

        <header className="profile-header-content">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar" aria-label={`${user?.name || "User"} avatar`}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile preview" />
              ) : (
                (user?.name || user?.username || "A").slice(0, 1).toUpperCase()
              )}
            </div>
            <button type="button" className="profile-avatar-button" title="Upload avatar" onClick={() => avatarInputRef.current?.click()}>
              <Camera size={15} />
            </button>
          </div>
          <input ref={avatarInputRef} className="profile-avatar-input" type="file" accept="image/*" onChange={uploadAvatar} />

          <div className="profile-identity">
            <div className="profile-name-row">
              <h2>{user?.name || user?.username || "Administrator"}</h2>
              <span className="profile-role-badge">{user?.role || "user"}</span>
            </div>
            <p>{user?.email || "No email address saved"}</p>
            <div className={`profile-verification ${user?.isVerified ? "verified" : "unverified"}`}>
              {user?.isVerified ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{user?.isVerified ? "Verified account" : "Email verification pending"}</span>
              {!user?.isVerified && (
                <button type="button" className="link-button" disabled={resending} onClick={resendConfirmation}>
                  {resending ? "Sending…" : "Resend confirmation"}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="profile-content">
          <div className="profile-section-heading">
            <div>
              <span>Account information</span>
              <h3>Personal details</h3>
            </div>
            <p>Manage your identity, access level, and account activity.</p>
          </div>

          <div className="profile-info-grid">
            {[
              { label: "Full name", value: user?.name || "Not set", icon: User },
              { label: "Email address", value: user?.email || "Not set", icon: Mail },
              { label: "Account role", value: user?.role || "Not set", icon: ShieldCheck },
              { label: "Username", value: user?.username || "Not set", icon: AtSign },
              { label: "Account status", value: user?.isVerified ? "Verified" : "Unverified", icon: user?.isVerified ? CheckCircle2 : AlertTriangle, tone: user?.isVerified ? "success" : "warning" },
              { label: "Last login", value: user?.lastLogin ? new Date(user.lastLogin).toLocaleString() : "No login recorded", icon: Clock3 }
            ].map(({ label, value, icon: Icon, tone }) => (
              <article className="profile-info-card" key={label}>
                <div className={`profile-info-icon ${tone || ""}`}>
                  <Icon size={19} />
                </div>
                <div>
                  <span>{label}</span>
                  <strong className={tone ? `profile-info-${tone}` : ""}>{value}</strong>
                </div>
              </article>
            ))}
          </div>

          <div className="profile-actions">
            <div className="profile-action-copy">
              <strong>Account settings</strong>
              <span>Update your profile image, personal details, or password.</span>
            </div>
            <button type="button" className="ghost-button" onClick={() => avatarInputRef.current?.click()}>
              <Camera size={18} />
              Upload Avatar
            </button>
            <button type="button" className="ghost-button" onClick={() => setView("password")}>
              <KeyRound size={18} />
              Change Password
            </button>
            <button type="button" className="primary-button" onClick={() => { setProfileForm({ name: user?.name || "", email: user?.email || "" }); setView("edit"); }}>
              <User size={18} />
              Edit Profile
            </button>
            {user?.role !== "admin" && (
              <button type="button" className="danger-button" onClick={() => setView("delete")}>
                <Trash2 size={18} />
                Delete Account
              </button>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}

// Audit rows store the actor as an id. The server resolves that to a name or
// address; the metadata recorded on the row is the fallback for entries
// written before that resolution existed.
function auditActor(row) {
  return row.userLabel || row.userEmail || row.metadata?.email || row.metadata?.name || "";
}

function friendlyIp(value) {
  const text = String(value || "").trim();
  if (!text) return "—";
  if (["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(text)) return "localhost";
  return text.replace(/^::ffff:/, "");
}

function AuditDetails({ metadata, actor }) {
  const entries = Object.entries(metadata || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    // The actor is already the User column; repeating it here is noise.
    .filter(([key, value]) => !(actor && String(value) === actor && ["email", "name", "username"].includes(key)));

  if (!entries.length) return <span className="audit-muted">—</span>;

  return (
    <div className="audit-meta">
      {entries.map(([key, value]) => (
        <span className="audit-chip" key={key}>
          <em>{humanize(key)}</em>
          {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </span>
      ))}
    </div>
  );
}

function AuditLogPage({ onNotice }) {
  const [filters, setFilters] = useState({ search: "", action: "", user: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ logs: [], page: 1, pages: 1, total: 0 });
  const [busy, setBusy] = useState(false);

  async function load(nextPage = page) {
    setBusy(true);
    try {
      const params = {
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
        page: nextPage,
        limit: 25
      };
      const result = await api.auditLogs(params);
      setData(result);
      setPage(result.page);
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  function applyFilters(event) {
    event.preventDefault();
    load(1);
  }

  const actionOptions = ["", "signup", "login", "logout", "profile_update", "password_change", "account_deletion", "create", "import", "ssr_check", "ssr_upload"];

  return (
    <section className="screen-grid">
      <form className="toolbar" onSubmit={applyFilters}>
        <Field label="Search">
          <div className="search-box">
            <Search size={17} />
            <input value={filters.search} placeholder="Search audit logs" onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </div>
        </Field>
        <Field label="Action">
          <select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
            {actionOptions.map((action) => (
              <option key={action || "all"} value={action}>{action || "All actions"}</option>
            ))}
          </select>
        </Field>
        <Field label="User">
          <input value={filters.user} placeholder="User id" onChange={(event) => setFilters({ ...filters, user: event.target.value })} />
        </Field>
        <Field label="From">
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </Field>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <Search size={17} />}
          {busy ? "Loading…" : "Filter"}
        </button>
      </form>

      <section className="panel wide">
        <div className="panel-heading">
          <h2>Audit Log</h2>
          <span className="mode-pill">{Number(data.total || 0).toLocaleString()} entries</span>
        </div>
        <DataTable
          rows={data.logs}
          columns={[
            { key: "createdAt", label: "Time", render: (row) => dateTime(row.createdAt) },
            {
              key: "user",
              label: "User",
              render: (row) => (
                <span className="audit-actor">
                  {auditActor(row) ? <strong>{auditActor(row)}</strong> : <strong className="audit-muted">Unknown</strong>}
                  {row.user && <small title={row.user}>{shortId(row.user)}</small>}
                </span>
              )
            },
            { key: "action", label: "Action", render: (row) => <span className="audit-action">{humanize(row.action)}</span> },
            {
              key: "resource",
              label: "Resource",
              render: (row) => (
                <span className="audit-actor">
                  <strong>{humanize(row.resource)}</strong>
                  {row.resourceId && row.resourceId !== row.user && (
                    <small title={row.resourceId}>{shortId(row.resourceId)}</small>
                  )}
                </span>
              )
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`audit-status ${row.status === "failure" ? "failure" : "success"}`}>
                  {row.status === "failure" ? "Failed" : "Success"}
                </span>
              )
            },
            { key: "ipAddress", label: "IP", render: (row) => friendlyIp(row.ipAddress) },
            { key: "metadata", label: "Details", render: (row) => <AuditDetails metadata={row.metadata} actor={auditActor(row)} /> }
          ]}
          empty={busy ? "Loading audit logs." : "No audit logs found."}
        />
        <div className="button-row audit-pagination">
          <button type="button" className="ghost-button" disabled={busy || page <= 1} onClick={() => load(page - 1)}>
            Previous
          </button>
          <span className="mode-pill">Page {data.page} of {data.pages}</span>
          <button type="button" className="ghost-button" disabled={busy || page >= data.pages} onClick={() => load(page + 1)}>
            Next
          </button>
        </div>
      </section>
    </section>
  );
}

function ReportsPage({ companies, distributors, products, onNotice }) {
  const [filters, setFilters] = useState({
    type: "monthly-sales",
    from: "",
    to: "",
    companyId: "",
    distributorId: "",
    productId: ""
  });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState("");

  async function loadReport(event) {
    event?.preventDefault();
    setBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const result = await api.reports(params);
      setReport(result);
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  async function download(format) {
    setDownloading(format);
    try {
      const params = Object.fromEntries(Object.entries({ ...filters, format }).filter(([, value]) => value));
      await api.downloadReport(params);
    } catch (error) {
      onNotice({ type: "error", message: error.message });
    } finally {
      setDownloading("");
    }
  }

  const rows = report?.rows || [];
  const columns = report?.columns || [];

  return (
    <section className="screen-grid">
      <form className="toolbar reports-toolbar" onSubmit={loadReport}>
        <Field label="Report">
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="monthly-sales">Monthly Sales Report</option>
            <option value="distributor">Distributor Report</option>
            <option value="product">Product Report</option>
            <option value="company">Company Report</option>
            <option value="audit">Audit Report</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </Field>
        <Field label="Company">
          <select value={filters.companyId} onChange={(event) => setFilters({ ...filters, companyId: event.target.value })}>
            <option value="">All companies</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.cname}</option>)}
          </select>
        </Field>
        <Field label="Distributor">
          <select value={filters.distributorId} onChange={(event) => setFilters({ ...filters, distributorId: event.target.value })}>
            <option value="">All distributors</option>
            {distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.dname}</option>)}
          </select>
        </Field>
        <Field label="Product">
          <select value={filters.productId} onChange={(event) => setFilters({ ...filters, productId: event.target.value })}>
            <option value="">All products</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.pname}</option>)}
          </select>
        </Field>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <Search size={17} />}
          {busy ? "Loading…" : "Preview"}
        </button>
      </form>

      <section className="panel wide">
        <div className="panel-heading reports-heading">
          <div>
            <h2>{report?.title || "Reports"}</h2>
            <span className="mode-pill">{Number(report?.total || 0).toLocaleString()} rows</span>
          </div>
          <div className="button-row">
            {[
              { format: "pdf", label: "PDF" },
              { format: "excel", label: "Excel" },
              { format: "csv", label: "CSV" }
            ].map(({ format, label }) => (
              <button
                key={format}
                type="button"
                className="ghost-button"
                aria-busy={downloading === format}
                disabled={busy || !rows.length || Boolean(downloading)}
                onClick={() => download(format)}
              >
                {downloading === format ? <span className="button-spinner" aria-hidden="true" /> : <Download size={17} />}
                {downloading === format ? "Preparing…" : label}
              </button>
            ))}
          </div>
        </div>
        {busy ? (
          <SkeletonBlock height={260} />
        ) : columns.length ? (
          <DataTable
            rows={rows}
            columns={columns.map((column) => ({
              key: column.key,
              label: column.label,
              render: (row) => typeof row[column.key] === "number" ? Number(row[column.key]).toLocaleString() : row[column.key]
            }))}
            empty="No report data found."
          />
        ) : (
          <EmptyState message="Choose filters and preview a report." />
        )}
      </section>
    </section>
  );
}

function activeFromPath(pathname) {
  const segment = pathname.replace(/^\/app\/?/, "").split("/")[0];
  return navItems.some((item) => item.id === segment) ? segment : "home";
}

function AppWorkspace() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const active = activeFromPath(location.pathname);
  const setActive = (id) => navigate(id === "home" ? "/app" : `/app/${id}`);
  const [notice, setNotice] = useState(null);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [fileActivity, setFileActivity] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Each panel of the workspace is fed by its own request. Promise.all used to
  // throw away six good responses because the seventh failed, blanking the
  // whole screen over one slow endpoint, so failures are now settled
  // individually and only the affected panels stay empty.
  async function refresh() {
    setLoadingData(true);
    setLoadingAnalytics(true);
    try {
      const sources = [
        { load: () => api.stats(), apply: setStats, label: "statistics" },
        { load: () => api.companies(), apply: setCompanies, label: "companies" },
        { load: () => api.distributors({ limit: 1000 }), apply: setDistributors, label: "distributors" },
        { load: () => api.products({ limit: 1000 }), apply: setProducts, label: "products" },
        { load: () => api.sales({ limit: 12 }), apply: setSales, label: "sales" },
        { load: () => api.fileActivity({ limit: 12 }), apply: setFileActivity, label: "file activity" },
        { load: () => api.dashboardAnalytics(), apply: setAnalytics, label: "analytics" }
      ];

      const results = await Promise.allSettled(sources.map((source) => source.load()));
      const failed = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          sources[index].apply(result.value);
        } else {
          failed.push({ label: sources[index].label, error: result.reason });
        }
      });

      // An expired session shows up on every request at once; send the user to
      // sign in rather than reporting seven separate failures.
      if (failed.some((item) => item.error?.status === 401)) {
        const expired = new Error("Your session has expired. Please sign in again.");
        expired.status = 401;
        throw expired;
      }

      if (failed.length === results.length) {
        throw new Error(failed[0].error?.message || "Could not load your workspace.");
      }

      if (failed.length) {
        setNotice({
          type: "warn",
          message: `Could not load ${listSentence(failed.map((item) => item.label))}. Everything else is up to date.`
        });
      } else {
        setNotice((current) => (current?.type === "warn" ? null : current));
      }
    } finally {
      setLoadingData(false);
      setLoadingAnalytics(false);
    }
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      setNotice(null);
      setStats(null);
      navigate("/", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => {
      if (error.status === 401) {
        logout();
        return;
      }
      setNotice({ type: "error", message: error.message });
    });
  }, []);

  const screens = {
    home: <HomeScreen stats={stats} sales={sales} fileActivity={fileActivity} loading={loadingData} onOpen={setActive} />,
    dashboard: <Dashboard analytics={analytics} loadingAnalytics={loadingAnalytics} onOpen={setActive} />,
    profile: <Profile onNotice={setNotice} onLogout={handleLogout} />,
    network: <Network companies={companies} distributors={distributors} onDone={refresh} onNotice={setNotice} />,
    ssr: <SsrUpload companies={companies} distributors={distributors} products={products} onDone={refresh} onNotice={setNotice} />,
    check: <CheckData onNotice={setNotice} />,
    products: <Products companies={companies} products={products} onDone={refresh} onNotice={setNotice} />,
    schemes: <Schemes onNotice={setNotice} />,
    services: <OtherServices onDone={refresh} onNotice={setNotice} />,
    missing: <MissingAliases products={products} onDone={refresh} onNotice={setNotice} />,
    summary: <Summary onNotice={setNotice} />,
    reports: <ReportsPage companies={companies} distributors={distributors} products={products} onNotice={setNotice} />,
    audit: <AuditLogPage onNotice={setNotice} />
  };

  return (
    <Shell
      active={active}
      onActive={setActive}
      stats={stats}
      onRefresh={() => refresh().catch((error) => setNotice({ type: "error", message: error.message }))}
      notice={notice}
      onClearNotice={() => setNotice(null)}
      currentUser={user?.name || user?.username || user?.email || "Account"}
      currentEmail={user?.email || ""}
      currentRole={user?.role || ""}
      onLogout={handleLogout}
      isLoggingOut={isLoggingOut}
    >
      {screens[active]}
    </Shell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordRequestPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/confirm" element={<ConfirmEmailPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
      <Route path="/admin-recovery" element={<ForgotPasswordPage />} />
      <Route
        path="/app/*"
        element={(
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
