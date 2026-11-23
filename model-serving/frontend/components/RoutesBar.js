import { bps, roleColor, roleOf } from "../lib/format";

export function RoutesBar({ routes, compact = false, flowing = false }) {
  const live = (routes || []).filter((r) => r.mode === "live");
  const shadow = (routes || []).find((r) => r.mode === "shadow");
  if (live.length === 0) return <p className="empty">Nothing is serving yet. Promote a version below.</p>;
  return (
    <div>
      <div className={`strip${compact ? " compact" : ""}${flowing ? " flowing" : ""}`} role="img"
        aria-label={live.map((r) => `v${r.version} ${roleOf(routes, r.versionId)} ${bps(r.weight)}`).join(", ")}>
        {live.map((r) => {
          const role = roleOf(routes, r.versionId);
          return (
            <div key={String(r.versionId)} className={`seg${r.weight < 2000 ? " narrow" : ""}`}
              style={{ flexGrow: r.weight, flexBasis: 0, background: roleColor(role), color: role === "canary" ? "var(--ink)" : "#fff" }}
              title={`v${r.version} ${role}: ${bps(r.weight)} of live traffic`}>
              <span className="ver">v{r.version}</span>
              <span className="share">{bps(r.weight)} <span className="role">{role}</span></span>
            </div>
          );
        })}
      </div>
      {shadow && (
        <div className="shadow-note">
          <i className="swatch" style={{ background: roleColor("shadow") }} />
          <span><b>v{shadow.version} shadow</b> scores a copy of every request and never answers.</span>
        </div>
      )}
    </div>
  );
}
