export function safeNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && ["", "-", "nan"].includes(value.trim().toLowerCase())) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function safeDecimal(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" && ["", "-", "nan"].includes(value.trim().toLowerCase())) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function normalizeMonth(value) {
  const normalized = String(value || "").trim().toLowerCase().slice(0, 3);
  return MONTHS.includes(normalized) ? normalized : null;
}
