import { Database } from "lucide-react";

// Shared presentational primitives. These live outside App.jsx so that the
// lazily loaded chart bundle can use them without importing App.jsx back.

export function SkeletonBlock({ height = 240 }) {
  return <div className="skeleton-block" style={{ minHeight: height }} />;
}

export function EmptyState({ message }) {
  return (
    <div className="empty-state analytics-empty">
      <Database size={22} />
      <span>{message}</span>
    </div>
  );
}
