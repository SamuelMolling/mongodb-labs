"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { RoutesBar } from "../components/RoutesBar";
import { ago } from "../lib/format";

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
      <div className="head-row"><h1>Models</h1></div>
      {error && <div className="toast err">Control plane unreachable: {error}. Is <code>make dev</code> running?</div>}
      {models && models.length === 0 && (
        <div className="card">
          <p>No models registered. Run <code>make setup</code> from the lab root.</p>
        </div>
      )}
      <div className="grid two">
        {(models || []).map((m) => (
          <Link key={m._id} href={`/models/${m._id}`} className="card model-card">
            <h2>{m._id} <span className="right muted small">{m.task}</span></h2>
            <p className="lead">{m.description}</p>
            <RoutesBar routes={m.deployment?.routes} />
            <p className="muted small" style={{ marginBottom: 0 }}>
              {m.lastVersion} version(s) · deployment revision {m.deployment?.revision ?? "—"} · changed {ago(m.deployment?.updatedAt)}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
