import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const RouterContext = createContext(null);

function normalizePath(path) {
  if (!path) return "/";
  const url = new URL(path, window.location.origin);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function BrowserRouter({ children }) {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state
  }));

  React.useEffect(() => {
    const sync = () => setLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: window.history.state
    });
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = useCallback((to, { replace = false, state = null } = {}) => {
    const target = normalizePath(to);
    window.history[replace ? "replaceState" : "pushState"](state, "", target);
    setLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state
    });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useNavigate() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useNavigate must be used inside BrowserRouter");
  return context.navigate;
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useLocation must be used inside BrowserRouter");
  return context.location;
}

export function Link({ to, children, onClick, ...props }) {
  const navigate = useNavigate();

  function handleClick(event) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={normalizePath(to)} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

export function Navigate({ to, replace = false, state = null }) {
  const navigate = useNavigate();

  React.useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);

  return null;
}

export function Route() {
  return null;
}

function matches(routePath, currentPath) {
  if (routePath === "*") return true;
  if (routePath.endsWith("/*")) {
    const base = routePath.slice(0, -2);
    return currentPath === base || currentPath.startsWith(`${base}/`);
  }
  return routePath === currentPath;
}

export function Routes({ children }) {
  const { location } = useContext(RouterContext);
  const routes = React.Children.toArray(children);
  const fallback = routes.find((route) => route.props.path === "*");
  const matched = routes.find((route) => route.props.path !== "*" && matches(route.props.path, location.pathname)) || fallback;
  return matched?.props.element || null;
}
