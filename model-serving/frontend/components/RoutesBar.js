import { bps, roleColor, roleOf } from "../lib/format";

/** Live traffic split as one segmented bar; shadow listed separately (it gets copies, not a share). */
export function RoutesBar({ routes }) {
  const live = (routes || []).filter((r) => r.mode === "live");
  const shadow = (routes || []).find((r) => r.mode === "shadow");
  if (live.length === 0) return <p className="muted">Nothing deployed yet. Promote a version below.</p>;
  return (
    <div>
      <div className="routes-bar" role="img"
        aria-label={live.map((r) => `v${r.version} ${bps(r.weight)}`).join(", ")}>
        {live.map((r) => (
          <div key={String(r.versionId)} className="seg"
            style={{ flex: r.weight, background: roleColor(roleOf(routes, r.versionId)) }}
            title={`v${r.version} — ${bps(r.weight)} of live traffic`}>
            v{r.version} · {bps(r.weight)}
          </div>
        ))}
      </div>
      <div className="legend">
        {live.map((r) => {
          const role = roleOf(routes, r.versionId);
          return (
            <span key={String(r.versionId)}>
              <i className="swatch" style={{ background: roleColor(role) }} /> v{r.version} {role} · {bps(r.weight)}
            </span>
          );
        })}
        {shadow && (
          <span>
            <i className="swatch" style={{ background: roleColor("shadow") }} /> v{shadow.version} shadow · copy of
            every request, never answers
          </span>
        )}
      </div>
    </div>
  );
}
