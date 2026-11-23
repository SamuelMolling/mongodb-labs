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
      <h1 className="page-title">Models</h1>
      <p className="page-sub">Each model has one deployment. Its traffic split lives in a single document that every serving node watches.</p>
      {error && <div className="toast err" role="status">Can’t reach the control plane ({error}). Start it with <code>make dev</code>.</div>}
      {models && models.length === 0 && (
        <p className="empty">No models registered yet. Run <code>make setup</code> from the lab root.</p>
      )}
      <div className="models">
        {(models || []).map((m) => (
          <Link key={m._id} href={`/models/${m._id}`} className="model-link">
            <h2>{m._id}</h2>
            <div className="task">{m.task}</div>
            <p>{m.description}</p>
            <RoutesBar routes={m.deployment?.routes} compact />
            <div className="foot">
              <span>{m.lastVersion} {m.lastVersion === 1 ? "version" : "versions"}</span>
              <span>Revision {m.deployment?.revision ?? "–"}</span>
              <span>Changed {ago(m.deployment?.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
