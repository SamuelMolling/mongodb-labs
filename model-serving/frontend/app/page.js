"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { RoutesBar } from "../components/RoutesBar";
import { Status } from "../components/Status";
import { ago, int } from "../lib/format";

const WINDOW = 15;

export default function Home() {
  const [models, setModels] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.listModels().then((m) => alive && (setModels(m), setError(null))).catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <main className="page">
      <div className="home-head">
        <h1 className="page-title">Models</h1>
        <p className="page-sub">Each model has one deployment. Its traffic split lives in a single document that every serving node watches.</p>
      </div>
      {error && <div className="toast err" role="status">Can’t reach the control plane ({error}). Start it with <code>make dev</code>.</div>}
      {models && models.length === 0 && (
        <p className="empty">No models registered yet. Run <code>make setup</code> from the lab root.</p>
      )}
      <div className="model-list">
        {(models || []).map((m) => <ModelRow key={m._id} model={m} />)}
      </div>
    </main>
  );
}

function ModelRow({ model: m }) {
  const [live, setLive] = useState({});

  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([api.fleet(m._id), api.alerts(m._id), api.metrics(m._id, WINDOW)])
      .then(([fleet, alerts, metrics]) => alive && setLive({ fleet, alerts, metrics }))
      .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [m._id]);

  const { fleet, alerts, metrics } = live;
  const requests = metrics ? metrics.rows.filter((r) => r.mode === "live").reduce((s, r) => s + r.n, 0) : null;

  return (
    <Link href={`/models/${m._id}`} className="model-row">
      <div className="who">
        <h2>{m._id}</h2>
        <p>{m.description}</p>
        <div className="foot">
          <span>{humanTask(m.task)}</span>
          <span>{m.lastVersion} {m.lastVersion === 1 ? "version" : "versions"}</span>
          <span>Revision {m.deployment?.revision ?? "–"}, changed {ago(m.deployment?.updatedAt)}</span>
        </div>
      </div>
      <div className="split">
        <RoutesBar routes={m.deployment?.routes} flowing={requests > 0 && fleet?.liveNodes > 0} />
      </div>
      <dl className="signals">
        <div>
          <dt>Live requests, last {WINDOW} min</dt>
          <dd className="big">{int(requests)}</dd>
        </div>
        <div>
          <dt>Fleet</dt>
          <dd>{fleetStatus(fleet)}</dd>
        </div>
        <div>
          <dt>Alerts</dt>
          <dd>{alerts == null ? "–" : alerts.length
            ? <Status kind="critical">{alerts.length} open</Status>
            : <Status kind="good">None open</Status>}</dd>
        </div>
      </dl>
    </Link>
  );
}

function fleetStatus(fleet) {
  if (!fleet) return "–";
  if (fleet.liveNodes === 0) return <Status kind="muted">No live nodes</Status>;
  if (fleet.converged) return <Status kind="good">{fleet.liveNodes} of {fleet.liveNodes} on r{fleet.revision}</Status>;
  return <Status kind="warning">{fleet.behind} of {fleet.liveNodes} behind</Status>;
}

const humanTask = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1).replaceAll("_", " ") : "");
