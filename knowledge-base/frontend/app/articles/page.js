"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { resolveWorkspaceId } from "../../lib/workspace";

export default function ArticlesPage() {
  const [articles, setArticles] = useState([]);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const wsId = await resolveWorkspaceId();
        setWorkspaceId(wsId);
        const list = await api.listArticles(wsId);
        setArticles(list);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Articles</h1>
        <Link href="/articles/new">
          <button>+ New article</button>
        </Link>
      </div>

      {error && <div className="error" style={{ marginTop: "1rem" }}>{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div style={{ marginTop: "1rem" }}>
        {articles.map((a) => (
          <div key={a._id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href={`/articles/${a._id}`}>
                <strong style={{ fontSize: "1.05rem" }}>{a.title}</strong>
              </Link>
              <span className="small muted">
                {new Date(a.updatedAt).toLocaleString()}
              </span>
            </div>
            {a.summary && (
              <p className="muted small" style={{ margin: "0.4rem 0" }}>
                {a.summary}
              </p>
            )}
            <div>
              {(a.tags || []).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              {a.category && (
                <span className="tag" style={{ background: "#243049" }}>
                  {a.category}
                </span>
              )}
            </div>
          </div>
        ))}
        {!loading && articles.length === 0 && (
          <p className="muted">No articles yet. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
