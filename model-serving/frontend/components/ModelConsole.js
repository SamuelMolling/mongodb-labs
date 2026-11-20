"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, SERVING_URLS } from "../lib/api";
import { ago, bps, int, ms, num, pct, roleColor, roleOf } from "../lib/format";
import { RoutesBar } from "./RoutesBar";
import { LineChart } from "./LineChart";
import { BinsChart } from "./BinsChart";
import { Status, psiStatus } from "./Status";

/**
 * The deployment console for one model.
 *
 * Every mutation sends the revision this page last saw (expectedRevision).
 * If someone else changed the deployment in between, the control plane
 * answers 409 and the page refreshes instead of overwriting their change.
 */
export function ModelConsole({ modelId }) {
  const [minutes, setMinutes] = useState(15);
  const [data, setData] = useState({});
  const [slow, setSlow] = useState({});
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadFast = useCallback(async () => {
    const [model, deployment, fleet, metrics, timeline, history, alerts] = await Promise.all([
      api.model(modelId), api.deployment(modelId), api.fleet(modelId), api.metrics(modelId, minutes),
      api.timeline(modelId, minutes), api.history(modelId), api.alerts(modelId),
    ]);
    setData({ model, deployment, fleet, metrics, timeline, history, alerts });
  }, [modelId, minutes]);

  const loadSlow = useCallback(async () => {
    const [drift, accuracy] = await Promise.all([api.drift(modelId, minutes), api.accuracy(modelId, Math.max(minutes, 60))]);
    setSlow({ drift, accuracy });
  }, [modelId, minutes]);

  useEffect(() => {
    let alive = true;
    const fast = () => loadFast().catch((e) => alive && setToast({ kind: "err", text: e.message }));
    const sl = () => loadSlow().catch(() => {});
    fast(); sl();
    const t1 = setInterval(fast, 3000);
    const t2 = setInterval(sl, 10000);
    return () => { alive = false; clearInterval(t1); clearInterval(t2); };
  }, [loadFast, loadSlow]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "err" ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const dep = data.deployment;
  const routes = dep?.routes || [];

  async function act(label, fn) {
    if (!dep) return;
    setBusy(true);
    try {
      const updated = await fn(dep.revision);
      setToast({ kind: "ok", text: `${label} → revision ${updated.revision}. Watch the fleet converge.` });
    } catch (e) {
      if (e.status === 409) {
        setToast({ kind: "err", text: `Not applied: ${e.message}. The page refreshed; review and retry.` });
      } else {
        setToast({ kind: "err", text: `${label} failed: ${e.message}` });
      }
    } finally {
      setBusy(false);
      loadFast().catch(() => {});
    }
  }

  const ops = {
    promote: (v) => act(`Promote v${v.version}`, (r) => api.promote(modelId, { versionId: v._id, expectedRevision: r })),
    canary: (v, weight) => act(weight ? `Canary v${v.version} at ${bps(weight)}` : "Stop canary",
      (r) => api.canary(modelId, { versionId: weight ? v._id : undefined, weight, expectedRevision: r })),
    shadow: (v) => act(v ? `Shadow v${v.version}` : "Stop shadow",
      (r) => api.shadow(modelId, { versionId: v ? v._id : null, expectedRevision: r })),
    rollback: () => act("Rollback", (r) => api.rollback(modelId, { expectedRevision: r })),
  };

  if (!dep) {
    return <main className="page"><p className="muted">Loading {modelId}…</p>{toast && <Toast t={toast} />}</main>;
  }

  const versions = data.model?.versions || [];
  const canaryRoute = routes.find((r) => r.mode === "live" && r.stage !== "production");
  const requests = (data.metrics?.rows || []).filter((r) => r.mode === "live").reduce((s, r) => s + r.n, 0);
  const fleet = data.fleet;

  return (
    <main className="page">
      <div className="head-row">
        <h1>{modelId}</h1>
        <span className="muted">{data.model?.model?.description}</span>
        <span className="spacer" style={{ marginLeft: "auto" }} />
        <label className="muted small">window&nbsp;
          <select className="sm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[5, 15, 60, 240].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
      </div>

      <div className="kpis">
        <Kpi label="Deployment revision" value={dep.revision} sub={`changed ${ago(dep.updatedAt)} by ${dep.updatedBy}`} />
        <Kpi label="Fleet" value={fleet ? `${fleet.liveNodes - fleet.behind}/${fleet.liveNodes}` : "—"}
          sub={fleet?.liveNodes ? (fleet.converged ? <Status kind="good">converged on r{fleet.revision}</Status>
            : <Status kind="warning">{fleet.behind} node(s) behind</Status>) : <Status kind="muted">no live nodes</Status>} />
        <Kpi label={`Live requests · ${minutes}m`} value={int(requests)} sub="from inference_log" />
        <Kpi label="Open alerts" value={(data.alerts || []).length}
          sub={(data.alerts || []).length ? <Status kind="critical">needs a look</Status> : <Status kind="good">none</Status>} />
      </div>

      <div className="grid side">
        <section className="card">
          <h2>Traffic
            <span className="right btn-row">
              <button className="sm danger" disabled={busy} onClick={ops.rollback}
                title="Promote the most recently archived version">Roll back</button>
            </span>
          </h2>
          <RoutesBar routes={routes} />
          {canaryRoute && (
            <CanaryControl route={canaryRoute} busy={busy}
              onSet={(w) => ops.canary(versions.find((v) => String(v._id) === String(canaryRoute.versionId)), w)} />
          )}
        </section>

        <section className="card">
          <h2>Fleet <span className="right muted small">heartbeat every 5s · stale after 15s</span></h2>
          <Fleet fleet={fleet} />
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Versions <span className="right muted small">registered by <code>make train</code> · immutable except stage</span></h2>
        <Versions versions={versions} routes={routes} busy={busy} ops={ops} />
      </section>

      <div className="grid two" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2>Requests per minute</h2>
          <LineChart series={toSeries(data.timeline, routes, "n")} yFormat={(v) => Math.round(v)} />
        </section>
        <section className="card">
          <h2>Flag rate per minute <span className="right muted small">share of requests scored ≥ threshold</span></h2>
          <LineChart series={toSeries(data.timeline, routes, "positiveRate")} yFormat={(v) => pct(v, 0)} />
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Live metrics <span className="right muted small">$percentile (approximate, t-digest) over inference_log</span></h2>
        <Metrics rows={data.metrics?.rows || []} routes={routes} />
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Drift & input contract
          <span className="right muted small">PSI vs training baseline · stable &lt; {slow.drift?.thresholds?.warn ?? 0.1} ≤ warn &lt; {slow.drift?.thresholds?.alert ?? 0.25} ≤ alert</span>
        </h2>
        <p className="lead">A model never returns 500 when it is wrong. These checks are the “no” it will never say.</p>
        <Drift drift={slow.drift} routes={routes} />
      </section>

      <div className="grid two" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2>Accuracy <span className="right muted small">labels arrive late · joined via $lookup</span></h2>
          <Accuracy rows={slow.accuracy?.rows || []} routes={routes} versions={versions} />
          <p className="muted small" style={{ marginBottom: 0 }}>
            Read accuracy last: with a ~12% churn rate, a model that flags nobody is ~88% accurate. Recall and Brier expose it.
          </p>
        </section>
        <section className="card">
          <h2>Open alerts <span className="right muted small">written by the scheduled check</span></h2>
          <Alerts alerts={data.alerts || []} />
        </section>
      </div>

      <div className="grid two" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2>History <span className="right muted small">deployment_history · one record per revision</span></h2>
          <History items={data.history || []} />
        </section>
        <section className="card">
          <h2>Playground</h2>
          <Playground modelId={modelId} />
        </section>
      </div>

      {toast && <Toast t={toast} />}
    </main>
  );
}

/* ------------------------------------------------------------------------ */

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function Toast({ t }) {
  return <div className={`toast ${t.kind}`} role="status">{t.text}</div>;
}

function VersionTag({ routes, versionId, version, mode }) {
  const role = mode === "shadow" ? "shadow" : roleOf(routes, versionId);
  return (
    <span className="pill">
      <i className="swatch" style={{ background: roleColor(role) }} /> v{version ?? "?"}
      {role && <span className="muted">{role}</span>}
    </span>
  );
}

function CanaryControl({ route, busy, onSet }) {
  const [w, setW] = useState(route.weight);
  useEffect(() => setW(route.weight), [route.weight]);
  return (
    <div className="btn-row" style={{ marginTop: ".9rem" }}>
      <span className="muted small">canary v{route.version}</span>
      <input type="range" min={100} max={9900} step={100} value={w} onChange={(e) => setW(Number(e.target.value))}
        style={{ width: 200, padding: 0 }} aria-label="canary weight" />
      <span className="mono small" style={{ width: 52 }}>{bps(w)}</span>
      <button className="sm" disabled={busy || w === route.weight} onClick={() => onSet(w)}>Apply</button>
      <button className="sm ghost" disabled={busy} onClick={() => onSet(0)}>Stop canary</button>
    </div>
  );
}

function Fleet({ fleet }) {
  if (!fleet) return null;
  if (fleet.nodes.length === 0) return <p className="muted">No serving nodes have reported. Start them with <code>make serve</code>.</p>;
  return (
    <div className="scroll-x">
      <table className="t">
        <thead><tr><th>node</th><th>status</th><th className="num">revision</th><th className="num">req</th><th className="num">events</th><th>seen</th></tr></thead>
        <tbody>
          {fleet.nodes.map((n) => (
            <tr key={n.nodeId} title={n.lastError || ""}>
              <td className="mono">{n.nodeId}</td>
              <td>
                {n.status === "serving" && n.revision === fleet.revision && <Status kind="good">serving</Status>}
                {n.status === "serving" && n.revision !== fleet.revision && <Status kind="warning">behind</Status>}
                {n.status === "degraded" && <Status kind="serious" title={n.lastError}>degraded</Status>}
                {n.status === "failed" && <Status kind="critical" title={n.lastError}>failed</Status>}
                {["stale", "waiting", "unknown", "removed"].includes(n.status) && <Status kind="muted">{n.status}</Status>}
              </td>
              <td className="num">{n.revision ?? "—"}</td>
              <td className="num">{int(n.stats?.requests)}</td>
              <td className="num">{int(n.stats?.changeEvents)}</td>
              <td className="muted small">{ago(n.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fleet.nodes.some((n) => n.lastError) && (
        <p className="small" style={{ color: "var(--status-serious)", marginBottom: 0 }}>
          {fleet.nodes.filter((n) => n.lastError).map((n) => `${n.nodeId}: ${n.lastError}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Versions({ versions, routes, busy, ops }) {
  const [canaryPct, setCanaryPct] = useState(10);
  const hasProd = versions.some((v) => v.stage === "production");
  return (
    <div className="scroll-x">
      <table className="t">
        <thead>
          <tr><th>version</th><th>stage</th><th>framework</th><th className="num">AUC</th><th className="num">logloss</th>
            <th className="num">flag rate</th><th>sha256</th><th>registered</th><th>actions</th></tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const route = routes.find((r) => String(r.versionId) === String(v._id));
            const isCanary = route && route.mode === "live" && v.stage !== "production";
            const isShadow = route?.mode === "shadow";
            return (
              <tr key={v._id}>
                <td><VersionTag routes={routes} versionId={v._id} version={v.version} mode={route?.mode} /></td>
                <td><span className={`pill stage-${v.stage}`}>{v.stage}</span></td>
                <td className="small" title={v.description}>{v.framework}</td>
                <td className="num">{num(v.metrics?.auc)}</td>
                <td className="num">{num(v.metrics?.logloss)}</td>
                <td className="num">{pct(v.metrics?.positiveRate)}</td>
                <td className="mono small" title={`${v.artifact?.uri}\n${v.artifact?.sha256}`}>{v.artifact?.sha256?.slice(0, 10)}…</td>
                <td className="muted small">{ago(v.registeredAt)}</td>
                <td>
                  <div className="btn-row">
                    {v.stage === "staging" && !isCanary && hasProd && (
                      <button className="sm ghost" disabled={busy} onClick={() => ops.canary(v, canaryPct * 100)}>Canary {canaryPct}%</button>
                    )}
                    {v.stage === "staging" && (
                      <button className="sm" disabled={busy} onClick={() => ops.promote(v)}>Promote 100%</button>
                    )}
                    {(v.stage === "staging" || v.stage === "archived") && !route && hasProd && (
                      <button className="sm ghost" disabled={busy} onClick={() => ops.shadow(v)}>Shadow</button>
                    )}
                    {isShadow && <button className="sm ghost" disabled={busy} onClick={() => ops.shadow(null)}>Stop shadow</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Canary size&nbsp;
        <select className="sm" value={canaryPct} onChange={(e) => setCanaryPct(Number(e.target.value))}>
          {[1, 5, 10, 25, 50].map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
        &nbsp;· a canary never reaches 100%: finishing a rollout is a promotion, so the registry always says what is in production.
      </p>
    </div>
  );
}

function Metrics({ rows, routes }) {
  if (rows.length === 0) return <p className="muted">No predictions in this window. Run <code>make load</code>.</p>;
  return (
    <div className="scroll-x">
      <table className="t">
        <thead>
          <tr><th>version</th><th>mode</th><th className="num">requests</th><th className="num">p50</th><th className="num">p95</th>
            <th className="num">p99</th><th className="num">flag rate</th><th className="num">at training</th><th className="num">imputed</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const drift = r.trainingPositiveRate != null && Math.abs(r.positiveRate - r.trainingPositiveRate) >= 0.05 && r.n >= 200;
            return (
              <tr key={`${r.versionId}-${r.mode}`}>
                <td><VersionTag routes={routes} versionId={r.versionId} version={r.version} mode={r.mode} /></td>
                <td className="muted">{r.mode}</td>
                <td className="num">{int(r.n)}</td>
                <td className="num">{ms(r.latencyMs.p50)}</td>
                <td className="num">{ms(r.latencyMs.p95)}</td>
                <td className="num">{ms(r.latencyMs.p99)}</td>
                <td className="num">{drift ? <Status kind="warning">{pct(r.positiveRate)}</Status> : pct(r.positiveRate)}</td>
                <td className="num muted">{pct(r.trainingPositiveRate)}</td>
                <td className="num">{r.imputed ? <Status kind="critical">{int(r.imputed)}</Status> : "0"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Drift({ drift, routes }) {
  const [sel, setSel] = useState(null);
  if (!drift) return <p className="muted">Computing…</p>;
  if (drift.reports.length === 0) return <p className="muted">Nothing deployed.</p>;
  return (
    <div className="grid two">
      {drift.reports.map((rep) => {
        const selected = rep.features.find((f) => sel?.v === rep.versionId && sel?.f === f.feature);
        return (
          <div key={rep.versionId}>
            <div style={{ marginBottom: ".4rem" }}><VersionTag routes={routes} versionId={rep.versionId} version={rep.version} mode={rep.mode} /></div>
            <table className="t">
              <thead><tr><th>feature</th><th className="num">n</th><th className="num">bad input</th><th className="num">PSI</th><th>band</th></tr></thead>
              <tbody>
                {rep.features.map((f) => (
                  <tr key={f.feature} style={{ cursor: "pointer", background: selected?.feature === f.feature ? "var(--panel-2)" : undefined }}
                    onClick={() => setSel({ v: rep.versionId, f: f.feature })}>
                    <td className="mono">{f.feature}</td>
                    <td className="num">{int(f.n)}</td>
                    <td className="num">{f.contract.broken ? <Status kind="critical">{pct(f.contract.badShare)}</Status> : pct(f.contract.badShare)}</td>
                    <td className="num">{f.psi == null ? "—" : num(f.psi)}</td>
                    <td><Status kind={psiStatus(f.band)}>{f.band}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selected ? (
              <div style={{ marginTop: ".7rem" }}>
                <div className="muted small">{selected.feature}: training vs live, same bins as $bucket</div>
                <BinsChart edges={selected.edges} training={selected.binsTraining} live={selected.binsLive} />
              </div>
            ) : (
              <p className="muted small">Click a feature to compare its distribution.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Accuracy({ rows, routes, versions }) {
  if (rows.length === 0) return <p className="muted">No labels yet. The load generator reports outcomes ~20s after each prediction.</p>;
  return (
    <table className="t">
      <thead><tr><th>version</th><th>mode</th><th className="num">labeled</th><th className="num">accuracy</th><th className="num">recall</th><th className="num">Brier ↓</th><th className="num">churn rate</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.versionId}-${r.mode}`}>
            <td><VersionTag routes={routes} versionId={r.versionId} version={r.version ?? versions.find((v) => v._id === r.versionId)?.version} mode={r.mode} /></td>
            <td className="muted">{r.mode}</td>
            <td className="num">{int(r.labeled)}</td>
            <td className="num">{pct(r.accuracy)}</td>
            <td className="num">{pct(r.recall)}</td>
            <td className="num">{num(r.brier)}</td>
            <td className="num muted">{pct(r.actualPositiveRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Alerts({ alerts }) {
  if (alerts.length === 0) return <p className="muted">Nothing open. The check runs every MONITOR_INTERVAL_SEC (60s by default).</p>;
  const kind = (a) => (a.check === "input_contract" || a.level === "alert" ? "critical" : "warning");
  return (
    <ul className="timeline">
      {alerts.map((a) => (
        <li key={a._id}>
          <span className="rev">v{a.version}</span>
          <div>
            <Status kind={kind(a)}>{a.check.replace("_", " ")}</Status> <span>{a.message}</span>
            <div className="muted small">since {ago(a.firstSeen)} · last {ago(a.lastSeen)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function History({ items }) {
  if (items.length === 0) return <p className="muted">No changes yet.</p>;
  return (
    <ul className="timeline">
      {items.map((h) => (
        <li key={h._id}>
          <span className="rev">r{h.revision}</span>
          <div>
            <strong>{h.action.replace("_", " ")}</strong> <span className="muted">— {h.note}</span>
            <div className="muted small">{h.actor} · {new Date(h.at).toLocaleString()}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const DEFAULT_FEATURES = { tenure_days: 45, seats: 6, tickets_30d: 4, logins_7d: 3, plan_tier: 1, mrr: 120 };

function Playground({ modelId }) {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [routingKey, setRoutingKey] = useState("user-42");
  const [node, setNode] = useState(SERVING_URLS[0]);
  const [result, setResult] = useState(null);

  async function send() {
    try {
      const f = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v === "" ? null : Number(v)]));
      setResult(await api.predict(node, modelId, { features: f, routingKey }));
    } catch (e) {
      setResult({ error: e.message });
    }
  }

  return (
    <div>
      <div className="feat-grid">
        {Object.keys(DEFAULT_FEATURES).map((k) => (
          <div key={k}>
            <label>{k}</label>
            <input className="sm" style={{ width: "100%" }} value={features[k] ?? ""} placeholder="null"
              onChange={(e) => setFeatures({ ...features, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="btn-row" style={{ margin: ".7rem 0" }}>
        <input className="sm" value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} aria-label="routing key" style={{ width: 130 }} />
        <select className="sm" value={node} onChange={(e) => setNode(e.target.value)}>
          {SERVING_URLS.map((u) => <option key={u} value={u}>{u.replace("http://", "")}</option>)}
        </select>
        <button className="sm" onClick={send}>Predict</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>Same routing key → same version, on every node. Clear a field to send null.</p>
      {result && <pre className="json">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function toSeries(timeline, routes, field) {
  const groups = new Map();
  for (const p of timeline?.points || []) {
    const key = `${p.versionId}|${p.mode}`;
    if (!groups.has(key)) {
      const role = p.mode === "shadow" ? "shadow" : roleOf(routes, p.versionId);
      groups.set(key, { key, label: `v${p.version}${role ? ` ${role}` : ""}`, color: roleColor(role), points: [] });
    }
    groups.get(key).points.push({ x: new Date(p.minute), y: p[field] ?? 0 });
  }
  return [...groups.values()];
}
