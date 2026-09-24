/**
 * Display formatting shared by the dashboard, the audit log and the tables.
 *
 * These decide how stored values are worded on screen -- an action slug, an
 * actor id, a timestamp -- so they live outside the component tree where they
 * can be checked directly.
 */

// Terms that are initialisms in this domain. Without them, sentence-casing
// turns "ssr_upload" into "Ssr upload", which is the sort of detail that makes
// a screen look machine-generated.
const ACRONYMS = new Set(["ssr", "id", "ip", "api", "url", "csv", "pdf", "xlsx"]);

/** Turns a stored slug ("missing-aliases") into a label ("Missing aliases"). */
export function humanize(value) {
  const text = String(value ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return "—";

  return text
    .split(/\s+/)
    .map((word, index) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

/**
 * Shortens an identifier to something that can be matched by eye against
 * another screen without taking a column's full width.
 */
export function shortId(value) {
  const text = String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

/**
 * Seconds are noise in a log read by eye, and they pushed every timestamp
 * column wide enough to crowd the columns carrying the meaning.
 */
export function dateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * An upload that finished but left work behind ("missing-aliases") is neither
 * a success nor a failure, and showing it as either misreads it.
 */
export function uploadTone(status) {
  const text = String(status ?? "").toLowerCase();
  if (text === "failed" || text === "error") return "failure";
  if (text === "processed" || text === "success") return "success";
  return "attention";
}
