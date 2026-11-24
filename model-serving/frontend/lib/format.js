export const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(d)}%`);
export const bps = (w) => `${(w / 100).toFixed(w % 100 === 0 ? 0 : 2)}%`;
export const ms = (x) => (x == null ? "—" : x < 10 ? `${x.toFixed(2)} ms` : `${x.toFixed(1)} ms`);
export const num = (x, d = 3) => (x == null || Number.isNaN(x) ? "—" : Number(x).toFixed(d));
export const int = (x) => (x == null ? "—" : Number(x).toLocaleString("en-US"));
export function ago(date) {
  if (!date) return "—";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Role of a version in the current routes: production | canary | shadow | null */
export function roleOf(routes, versionId) {
  const r = (routes || []).find((x) => String(x.versionId) === String(versionId));
  if (!r) return null;
  if (r.mode === "shadow") return "shadow";
  return r.stage === "production" ? "production" : "canary";
}
export const roleColor = (role) => `var(--role-${role || "other"})`;
