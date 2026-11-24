const MAP = {
  good: { ico: "✓", cls: "good" },
  warning: { ico: "!", cls: "warning" },
  serious: { ico: "▲", cls: "serious" },
  critical: { ico: "✕", cls: "critical" },
  muted: { ico: "–", cls: "muted" },
};

export function Status({ kind = "muted", children, title }) {
  const s = MAP[kind] || MAP.muted;
  return (
    <span className={`status ${s.cls}`} title={title}>
      <span className="ico" aria-hidden>{s.ico}</span>
      {children}
    </span>
  );
}

export const psiStatus = (band) =>
  ({ stable: "good", warn: "warning", alert: "critical", insufficient: "muted" })[band] || "muted";
