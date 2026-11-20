"use client";

import { useState } from "react";

/**
 * Training vs live share per bin for one feature: grouped bars, one y-axis,
 * a 2px gap between bars, a hover tooltip per bar. Two series -> legend.
 * The last group is out_of_range: values the model never saw in training.
 */
export function BinsChart({ edges, training, live, height = 150 }) {
  const [hover, setHover] = useState(null);
  const total = live.reduce((s, x) => s + x, 0) || 1;
  const liveShare = live.map((x) => x / total);
  const labels = edges.slice(0, -1).map((e, i) => `[${fmt(e)}, ${fmt(edges[i + 1])})`).concat("out of range");
  const W = 640, H = height, pad = { l: 40, r: 8, t: 8, b: 22 };
  const n = labels.length;
  const gw = (W - pad.l - pad.r) / n;
  const bw = Math.max(3, (gw - 8) / 2);
  const yMax = Math.max(0.05, ...training, ...liveShare);
  const sy = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const colors = { training: "var(--role-other)", live: "var(--role-production)" };

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
        <g className="axis">
          {[0, yMax / 2, yMax].map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">{Math.round(t * 100)}%</text>
            </g>
          ))}
          <text x={pad.l + gw * (n - 0.5)} y={H - 6} textAnchor="middle">OOR</text>
        </g>
        {labels.map((lab, i) => {
          const x = pad.l + i * gw + (gw - 2 * bw - 2) / 2;
          return (
            <g key={lab} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * gw} y={pad.t} width={gw} height={H - pad.t - pad.b} fill="transparent" />
              <Bar x={x} w={bw} y={sy(training[i] || 0)} base={base} fill={colors.training} />
              <Bar x={x + bw + 2} w={bw} y={sy(liveShare[i] || 0)} base={base} fill={colors.live} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${((pad.l + (hover + 0.5) * gw) / W) * 100}%`, top: 0 }}>
          <div className="muted">{labels[hover]}</div>
          <div className="row"><i className="swatch" style={{ background: colors.training }} /> training {(100 * (training[hover] || 0)).toFixed(1)}%</div>
          <div className="row"><i className="swatch" style={{ background: colors.live }} /> live {(100 * liveShare[hover]).toFixed(1)}% ({live[hover]})</div>
        </div>
      )}
      <div className="legend">
        <span><i className="swatch" style={{ background: colors.training }} /> training share</span>
        <span><i className="swatch" style={{ background: colors.live }} /> live share</span>
      </div>
    </div>
  );
}

function Bar({ x, w, y, base, fill }) {
  const h = Math.max(0, base - y);
  if (h < 0.5) return null;
  const r = Math.min(4, w / 2, h);
  // Rounded data-end (top), square at the baseline.
  return (
    <path fill={fill}
      d={`M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`} />
  );
}

function fmt(v) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 0);
}
