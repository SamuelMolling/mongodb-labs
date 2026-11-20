"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Small multi-series line chart, hand-rolled SVG.
 *
 *   series: [{ key, label, color, points: [{ x: Date|number, y: number }] }]
 *
 * One y-axis (never two). 2px lines, recessive grid, a legend for >= 2
 * series plus a direct label at each line's end, and a crosshair tooltip on
 * hover listing every series at the nearest x.
 */
export function LineChart({ series, height = 170, yFormat = (v) => v, yMin = 0, empty = "No data in this window yet." }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = height;
  const pad = { l: 46, r: 70, t: 8, b: 22 };

  const all = series.flatMap((s) => s.points);
  const xs = useMemo(() => [...new Set(all.map((p) => +p.x))].sort((a, b) => a - b), [all]);
  if (all.length === 0) return <p className="muted small">{empty}</p>;

  const x0 = xs[0];
  const x1 = xs[xs.length - 1] === x0 ? x0 + 60_000 : xs[xs.length - 1];
  const yMaxRaw = Math.max(...all.map((p) => p.y));
  const yMax = yMaxRaw <= yMin ? yMin + 1 : niceMax(yMaxRaw);
  const sx = (x) => pad.l + ((+x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const ticks = [0, 0.5, 1].map((f) => yMin + f * (yMax - yMin));
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = xs[0];
    for (const x of xs) if (Math.abs(sx(x) - px) < Math.abs(sx(best) - px)) best = x;
    setHover(best);
  }

  const hoverRows = hover == null ? [] : series
    .map((s) => ({ s, p: s.points.find((p) => +p.x === hover) }))
    .filter((r) => r.p);

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          <text x={pad.l} y={H - 4}>{time(x0)}</text>
          <text x={W - pad.r} y={H - 4} textAnchor="end">{time(x1)}</text>
        </g>
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => +a.x - +b.x);
          const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
          const last = pts[pts.length - 1];
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.length === 1 && <circle cx={sx(last.x)} cy={sy(last.y)} r="4" fill={s.color} />}
            </g>
          );
        })}
        {endLabels(series, sx, sy).map((l) => (
          <text key={l.key} x={l.x + 6} y={l.y + 4} fill="var(--text)" fontSize="11" fontFamily="var(--mono)">{l.label}</text>
        ))}
        {hover != null && (
          <g>
            <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeDasharray="3 3" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.key} cx={sx(p.x)} cy={sy(p.y)} r="4" fill={s.color} stroke="var(--panel)" strokeWidth="2" />
            ))}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" />
      </svg>
      {hover != null && hoverRows.length > 0 && (
        <div className="tip" style={{ left: `${(sx(hover) / W) * 100}%`, top: 0 }}>
          <div className="muted">{time(hover)}</div>
          {hoverRows.map(({ s, p }) => (
            <div className="row" key={s.key}>
              <i className="swatch" style={{ background: s.color }} /> {s.label}: {yFormat(p.y)}
            </div>
          ))}
        </div>
      )}
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}><i className="swatch" style={{ background: s.color }} /> {s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** End-of-line labels, nudged apart vertically so overlapping lines stay readable. */
function endLabels(series, sx, sy, gap = 13) {
  const labels = series.map((s) => {
    const last = [...s.points].sort((a, b) => +a.x - +b.x).at(-1);
    return { key: s.key, label: s.label, x: sx(last.x), y: sy(last.y) };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
  }
  return labels;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
