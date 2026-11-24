"use client";

import Link from "next/link";
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
    return <main className="page"><p className="empty">Loading {modelId}…</p>{toast && <Toast t={toast} />}</main>;
  }

  const versions = data.model?.versions || [];
  const canaryRoute = routes.find((r) => r.mode === "live" && r.stage !== "production");
  const requests = (data.metrics?.rows || []).filter((r) => r.mode === "live").reduce((s, r) => s + r.n, 0);
  const fleet = data.fleet;
  const alerts = data.alerts || [];

  return (
    <main className="page">
      <header className="model-head">
        <div>
          <div className="crumb"><Link href="/">Models</Link></div>
          <h1>{modelId}</h1>
          <p>{data.model?.model?.description}</p>
        </div>
        <div className="tools">
          <span id="window-label">Window</span>
          <div className="segmented" role="group" aria-labelledby="window-label">
            {[5, 15, 60, 240].map((m) => (
              <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>
            ))}
          </div>
        </div>
      </header>

      <section className="serving" aria-labelledby="serving-title">
        <div>
          <div className="serving-top">
            <h2 id="serving-title">Serving now</h2>
            <LivePill on={requests > 0 && fleet?.liveNodes > 0} />
            <span className="rev">Revision <b>{dep.revision}</b>, changed {ago(dep.updatedAt)} by {dep.updatedBy}</span>
            <button className="sm danger" disabled={busy} onClick={ops.rollback}
              title="Put the most recently archived version back in production">Roll back</button>
          </div>
          <RoutesBar routes={routes} flowing={requests > 0 && fleet?.liveNodes > 0} />
          {canaryRoute && (
            <CanaryControl route={canaryRoute} busy={busy}
              onSet={(w) => ops.canary(versions.find((v) => String(v._id) === String(canaryRoute.versionId)), w)} />
          )}
          <div className="facts">
            <div className="fact">
              <div className="v">{int(requests)}</div>
              <div className="l">Live requests, last {minutes} min</div>
            </div>
            <div className="fact">
              <div className="v">{alerts.length}</div>
              <div className="l">Open alerts</div>
              <div className="s">{alerts.length ? <Status kind="critical">Needs a look</Status> : <Status kind="good">All checks quiet</Status>}</div>
            </div>
          </div>
        </div>
        <Fleet fleet={fleet} />
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Versions</h2>
          <p className="note">Registered by <code>make train</code>. Only the stage ever changes.</p>
        </div>
        <div className="panel">
          <Versions versions={versions} routes={routes} busy={busy} ops={ops} />
        </div>
      </section>

      <div className="grid two">
        <section className="block">
          <div className="block-head"><h2>Requests per minute</h2></div>
          <div className="panel">
            <LineChart series={toSeries(data.timeline, routes, "n", minutes)} yFormat={(v) => Math.round(v)} />
          </div>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>Flag rate per minute</h2>
            <p className="note">Share of requests scored at or above the threshold</p>
          </div>
          <div className="panel">
            <LineChart series={toSeries(data.timeline, routes, "positiveRate", minutes)} yFormat={(v) => pct(v, 0)} />
          </div>
        </section>
      </div>

      <section className="block">
        <div className="block-head">
          <h2>Live metrics</h2>
          <p className="note">Approximate percentiles from <code>$percentile</code> over <code>inference_log</code></p>
        </div>
        <div className="panel">
          <Metrics rows={data.metrics?.rows || []} routes={routes} />
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Drift &amp; input contract</h2>
          <p className="note">
            PSI against the training baseline: stable below {slow.drift?.thresholds?.warn ?? 0.1}, alert from {slow.drift?.thresholds?.alert ?? 0.25}
          </p>
        </div>
        <p className="lead">A wrong model still answers 200. These checks are how the platform finds out.</p>
        <div className="panel">
          <Drift drift={slow.drift} routes={routes} />
        </div>
      </section>

      <div className="grid two">
        <section className="block">
          <div className="block-head">
            <h2>Accuracy</h2>
            <p className="note">Labels arrive late and are joined with <code>$lookup</code></p>
          </div>
          <div className="panel">
            <Accuracy rows={slow.accuracy?.rows || []} routes={routes} versions={versions} />
          </div>
          <p className="footnote">
            Read accuracy last. With about 12% churn, a model that flags nobody is about 88% accurate; recall and Brier score expose it.
          </p>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>Open alerts</h2>
            <p className="note">Written by the scheduled check</p>
          </div>
          <div className="panel">
            <Alerts alerts={alerts} />
          </div>
        </section>
      </div>

      <div className="grid two">
        <section className="block">
          <div className="block-head">
            <h2>History</h2>
            <p className="note">One record per revision in <code>deployment_history</code></p>
          </div>
          <div className="panel">
            <History items={data.history || []} />
          </div>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>Playground</h2>
          </div>
          <div className="panel">
            <Playground modelId={modelId} routes={routes} />
          </div>
        </section>
      </div>

      {toast && <Toast t={toast} />}
    </main>
  );
}

function LivePill({ on }) {
  return <span className={`live-pill${on ? " on" : ""}`}><i aria-hidden />{on ? "Taking traffic" : "No traffic"}</span>;
}

function Toast({ t }) {
  return <div className={`toast ${t.kind}`} role="status">{t.text}</div>;
}

function VersionTag({ routes, versionId, version, mode }) {
  const role = mode === "shadow" ? "shadow" : roleOf(routes, versionId);
  return (
    <span className="tag">
      <i className="swatch" style={{ background: roleColor(role) }} /> v{version ?? "?"}
      {role && <span className="role">{role}</span>}
    </span>
  );
}

function CanaryControl({ route, busy, onSet }) {
  const [w, setW] = useState(route.weight);
  useEffect(() => setW(route.weight), [route.weight]);
  return (
    <div className="canary-ctl">
      <span>Canary v{route.version}</span>
      <input type="range" min={100} max={9900} step={100} value={w} onChange={(e) => setW(Number(e.target.value))}
        aria-label={`Canary weight for v${route.version}`} />
      <span className="val">{bps(w)}</span>
      <button className="sm" disabled={busy || w === route.weight} onClick={() => onSet(w)}>Apply {bps(w)}</button>
      <button className="sm ghost" disabled={busy} onClick={() => onSet(0)}>Stop canary</button>
    </div>
  );
}

function nodeState(n, revision) {
  if (n.status === "serving") return n.revision === revision ? ["", "Serving"] : ["behind", "Behind"];
  if (n.status === "degraded" || n.status === "failed") return ["down", n.status === "failed" ? "Failed" : "Degraded"];
  const s = n.status || "unknown";
  return ["idle", s.charAt(0).toUpperCase() + s.slice(1)];
}

function Fleet({ fleet }) {
  if (!fleet) return <div className="nodes" />;
  const summary = fleet.liveNodes === 0 ? "No live nodes"
    : fleet.converged ? `All ${fleet.liveNodes} nodes on revision ${fleet.revision}`
    : `${fleet.behind} of ${fleet.liveNodes} nodes behind revision ${fleet.revision}`;
  return (
    <div className="nodes">
      <h3>Fleet</h3>
      <p className="sub">{summary}. Heartbeat every 5 s, stale after 15 s.</p>
      {fleet.nodes.length === 0 && <p className="empty">No serving node has reported. Start them with <code>make serve</code>.</p>}
      {fleet.nodes.map((n) => {
        const [cls, label] = nodeState(n, fleet.revision);
        return (
          <div className="node" key={n.nodeId}>
            <span className={`dot ${cls}`} aria-hidden />
            <span className="name">{n.nodeId}</span>
            <span className="rv">{label}, r{n.revision ?? "–"}</span>
            <span className="meta">{int(n.stats?.requests)} requests, {int(n.stats?.changeEvents)} change {n.stats?.changeEvents === 1 ? "event" : "events"}, seen {ago(n.lastSeen)}</span>
            {n.lastError && <span className="err">{n.lastError}</span>}
          </div>
        );
      })}
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
          <tr><th>Version</th><th>Stage</th><th>Framework</th><th className="num">AUC</th><th className="num">Log loss</th>
            <th className="num">Flag rate</th><th>Artifact</th><th>Registered</th><th><span className="sr">Actions</span></th></tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const route = routes.find((r) => String(r.versionId) === String(v._id));
            const isCanary = route && route.mode === "live" && v.stage !== "production";
            const isShadow = route?.mode === "shadow";
            return (
              <tr key={v._id}>
                <td><VersionTag routes={routes} versionId={v._id} version={v.version} mode={route?.mode} /></td>
                <td><span className={`stage stage-${v.stage}`}>{v.stage}</span></td>
                <td title={v.description}>{v.framework?.replace("sklearn/", "")}</td>
                <td className="num">{num(v.metrics?.auc)}</td>
                <td className="num">{num(v.metrics?.logloss)}</td>
                <td className="num">{pct(v.metrics?.positiveRate)}</td>
                <td className="mono muted" title={`${v.artifact?.uri}\n${v.artifact?.sha256}`}>{v.artifact?.sha256?.slice(0, 8)}</td>
                <td className="muted">{ago(v.registeredAt)}</td>
                <td>
                  <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                    {v.stage === "staging" && !isCanary && hasProd && (
                      <button className="sm ghost" disabled={busy} onClick={() => ops.canary(v, canaryPct * 100)}>Canary {canaryPct}%</button>
                    )}
                    {(v.stage === "staging" || v.stage === "archived") && !route && hasProd && (
                      <button className="sm ghost" disabled={busy} onClick={() => ops.shadow(v)}>Shadow</button>
                    )}
                    {isShadow && <button className="sm ghost" disabled={busy} onClick={() => ops.shadow(null)}>Stop shadow</button>}
                    {v.stage === "staging" && (
                      <button className="sm" disabled={busy} onClick={() => ops.promote(v)}>Promote</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="footnote" style={{ marginLeft: 0 }}>
        New canaries start at&nbsp;
        <select className="sm" value={canaryPct} onChange={(e) => setCanaryPct(Number(e.target.value))} aria-label="Canary size">
          {[1, 5, 10, 25, 50].map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
        . A canary never reaches 100%: finishing a rollout is a promotion, so the registry always says what is in production.
      </p>
    </div>
  );
}

function Metrics({ rows, routes }) {
  if (rows.length === 0) return <p className="empty">No predictions in this window. Send traffic with <code>make load</code>.</p>;
  return (
    <div className="scroll-x">
      <table className="t">
        <thead>
          <tr><th>Version</th><th>Mode</th><th className="num">Requests</th><th className="num">p50</th><th className="num">p95</th>
            <th className="num">p99</th><th className="num">Flag rate</th><th className="num">At training</th><th className="num">Imputed</th></tr>
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
  if (!drift) return <p className="empty">Computing drift…</p>;
  if (drift.reports.length === 0) return <p className="empty">Nothing is deployed, so there is nothing to compare.</p>;
  return (
    <div>
      {drift.reports.map((rep) => {
        const selected = rep.features.find((f) => sel?.v === rep.versionId && sel?.f === f.feature) || rep.features[0];
        return (
          <div key={rep.versionId} className="drift-report">
            <div>
              <div style={{ marginBottom: ".6rem" }}><VersionTag routes={routes} versionId={rep.versionId} version={rep.version} mode={rep.mode} /></div>
              <table className="t">
                <thead><tr><th>Feature</th><th className="num">Rows</th><th className="num">Bad input</th><th className="num">PSI</th><th>Band</th></tr></thead>
                <tbody>
                  {rep.features.map((f) => (
                    <tr key={f.feature} className={`clickable${selected?.feature === f.feature ? " selected" : ""}`}
                      tabIndex={0} aria-selected={selected?.feature === f.feature}
                      onClick={() => setSel({ v: rep.versionId, f: f.feature })}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel({ v: rep.versionId, f: f.feature }))}>
                      <td className="mono">{f.feature}</td>
                      <td className="num">{int(f.n)}</td>
                      <td className="num">{f.contract.broken ? <Status kind="critical">{pct(f.contract.badShare)}</Status> : pct(f.contract.badShare)}</td>
                      <td className="num">{f.psi == null ? "–" : num(f.psi)}</td>
                      <td><Status kind={psiStatus(f.band)}>{f.band}</Status></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected && (
              <div>
                <div className="small" style={{ color: "var(--ink-2)", marginBottom: ".4rem" }}>
                  <b className="mono">{selected.feature}</b>: training versus live, binned like <code>$bucket</code>
                </div>
                <BinsChart edges={selected.edges} training={selected.binsTraining} live={selected.binsLive} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Accuracy({ rows, routes, versions }) {
  if (rows.length === 0) return <p className="empty">No labels yet. The load generator reports outcomes about 20 s after each prediction.</p>;
  return (
    <div className="scroll-x">
      <table className="t">
        <thead><tr><th>Version</th><th className="num">Labeled</th><th className="num">Accuracy</th><th className="num">Recall</th><th className="num">Brier ↓</th><th className="num">Churn rate</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.versionId}-${r.mode}`}>
              <td><VersionTag routes={routes} versionId={r.versionId} version={r.version ?? versions.find((v) => v._id === r.versionId)?.version} mode={r.mode} /></td>
              <td className="num">{int(r.labeled)}</td>
              <td className="num">{pct(r.accuracy)}</td>
              <td className="num">{pct(r.recall)}</td>
              <td className="num">{num(r.brier)}</td>
              <td className="num muted">{pct(r.actualPositiveRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Alerts({ alerts }) {
  if (alerts.length === 0) return <p className="empty">Nothing open. The check runs every <code>MONITOR_INTERVAL_SEC</code>, 60 s by default.</p>;
  const kind = (a) => (a.check === "input_contract" || a.level === "alert" ? "critical" : "warning");
  return (
    <ul className="timeline">
      {alerts.map((a) => (
        <li key={a._id}>
          <span className="rev">v{a.version}</span>
          <div>
            <Status kind={kind(a)}><span className="what">{a.check.replace("_", " ")}</span></Status>
            <div>{a.message}</div>
            <div className="when">Open since {ago(a.firstSeen)}, last seen {ago(a.lastSeen)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function History({ items }) {
  if (items.length === 0) return <p className="empty">No changes yet.</p>;
  return (
    <ul className="timeline">
      {items.map((h) => (
        <li key={h._id}>
          <span className="rev">r{h.revision}</span>
          <div>
            <span className="what">{h.action.replace("_", " ")}</span> <span style={{ color: "var(--ink-2)" }}>{h.note}</span>
            <div className="when">{h.actor}, {new Date(h.at).toLocaleString()}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const DEFAULT_FEATURES = { tenure_days: 45, seats: 6, tickets_30d: 4, logins_7d: 3, plan_tier: 1, mrr: 120 };

function Playground({ modelId, routes }) {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [routingKey, setRoutingKey] = useState("user-42");
  const [node, setNode] = useState(SERVING_URLS[0]);
  const [result, setResult] = useState(null);

  async function send() {
    try {
      const f = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v === "" ? null : Number(v)]));
      setResult(await api.predict(node, modelId, { features: f, routingKey }));
    } catch (e) {
      setResult({ error: `${node.replace("http://", "")} did not answer: ${e.message}` });
    }
  }

  return (
    <div>
      <div className="feat-grid">
        {Object.keys(DEFAULT_FEATURES).map((k) => (
          <div key={k}>
            <label htmlFor={`f-${k}`}>{k}</label>
            <input id={`f-${k}`} className="sm" style={{ width: "100%" }} value={features[k] ?? ""} placeholder="null" inputMode="decimal"
              onChange={(e) => setFeatures({ ...features, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="predict-row">
        <input className="sm" value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} aria-label="Routing key" style={{ width: 140 }} />
        <select className="sm" value={node} onChange={(e) => setNode(e.target.value)} aria-label="Serving node">
          {SERVING_URLS.map((u) => <option key={u} value={u}>{u.replace("http://", "")}</option>)}
        </select>
        <button className="sm" onClick={send}>Predict</button>
      </div>
      <p className="footnote" style={{ margin: 0 }}>The same routing key reaches the same version on every node. Clear a field to send null.</p>
      {result && (
        <div className="result" aria-live="polite">
          {result.error ? (
            <Status kind="critical">{result.error}</Status>
          ) : (
            <>
              <div className="score">{pct(result.score)}</div>
              <div className="why">
                Churn probability from <VersionTag routes={routes} versionId={result.versionId} version={result.version} mode="live" />{" "}
                on {result.node}, {ms(result.latencyMs)}.{" "}
                {result.label ? "Flagged" : "Not flagged"} at a threshold of {pct(result.threshold)}.
                {result.imputed?.length > 0 && ` Imputed: ${result.imputed.join(", ")}.`}
              </div>
            </>
          )}
          <details>
            <summary>Raw response</summary>
            <pre className="json">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function toSeries(timeline, routes, field, minutes) {
  const groups = new Map();
  const openMinute = Math.floor(Date.now() / 60000) * 60000;
  const firstFull = openMinute - (minutes - 1) * 60000;
  for (const p of timeline?.points || []) {
    const t = new Date(p.minute).getTime();
    if (t >= openMinute || t < firstFull) continue;
    const key = `${p.versionId}|${p.mode}`;
    if (!groups.has(key)) {
      const role = p.mode === "shadow" ? "shadow" : roleOf(routes, p.versionId);
      groups.set(key, { key, label: `v${p.version}${role ? ` ${role}` : ""}`, color: roleColor(role), points: [] });
    }
    groups.get(key).points.push({ x: new Date(p.minute), y: p[field] ?? 0 });
  }
  return [...groups.values()];
}
