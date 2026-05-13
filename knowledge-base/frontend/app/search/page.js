"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { resolveWorkspaceId } from "../../lib/workspace";

const MODES = [
  { id: "keyword", label: "Keyword", hint: "Atlas Search ($search)" },
  { id: "semantic", label: "Semantic", hint: "Atlas Vector Search ($vectorSearch)" },
  { id: "hybrid", label: "Hybrid", hint: "Reciprocal Rank Fusion" },
];

export default function SearchPage() {
  const [workspaceId, setWorkspaceId] = useState(null);
  const [mode, setMode] = useState("hybrid");
  const [query, setQuery] = useState("");
  const [withRerank, setWithRerank] = useState(false);
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    resolveWorkspaceId().then(setWorkspaceId);
  }, []);

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      let res;
      const body = { query, workspaceId };
      if (mode === "keyword") res = await api.searchKeyword(body);
      else if (mode === "semantic")
        res = await api.searchSemantic({ ...body, withRerank });
      else res = await api.searchHybrid(body);
      setResults(res.results);
      setMeta({ type: res.type, count: res.results.length });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Search</h1>
      <p className="muted">
        Try the same query across three retrieval strategies. All three hit
        MongoDB Atlas — no separate search engine, no separate vector store.
      </p>

      <div className="search-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={mode === m.id ? "active" : ""}
            onClick={() => setMode(m.id)}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: "-0.5rem" }}>
        {MODES.find((m) => m.id === mode).hint}
      </p>

      <form onSubmit={handleSearch}>
        <div className="row" style={{ marginTop: "1rem" }}>
          <input
            placeholder="e.g. how do I combine keyword and vector search?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 300 }}
          />
          <button type="submit" disabled={loading}>
            {loading && <span className="spinner" />}
            Search
          </button>
        </div>
        {mode === "semantic" && (
          <label className="row small muted" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={withRerank}
              onChange={(e) => setWithRerank(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>Rerank top results with Voyage rerank-2</span>
          </label>
        )}
      </form>

      {error && <div className="error" style={{ marginTop: "1rem" }}>{error}</div>}

      {meta && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          {meta.count} result(s) · type=<code className="mono">{meta.type}</code>
        </p>
      )}

      <div className="card" style={{ marginTop: ".5rem" }}>
        {results.length === 0 && !loading && (
          <p className="muted">
            No results yet. Try{" "}
            <em>“how should I chunk documents for RAG?”</em> or{" "}
            <em>“atlas vector search”</em>.
          </p>
        )}
        {results.map((r) => (
          <div key={r._id} className="result-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href={`/articles/${r._id}`}>
                <span className="result-title">{r.title}</span>
              </Link>
              <span className="result-score">
                {r.rrfScore !== undefined && `rrf=${r.rrfScore.toFixed(4)}`}
                {r.rerankScore !== undefined &&
                  ` rerank=${r.rerankScore.toFixed(3)}`}
                {r.score !== undefined &&
                  r.rrfScore === undefined &&
                  ` score=${r.score.toFixed(3)}`}
              </span>
            </div>
            {r.summary && (
              <p className="muted small" style={{ margin: "0.25rem 0" }}>
                {r.summary}
              </p>
            )}
            {r.bestChunk && (
              <p className="small" style={{ margin: "0.4rem 0" }}>
                <em>{r.bestChunk.slice(0, 280)}…</em>
              </p>
            )}
            {r.highlights && r.highlights.length > 0 && (
              <div className="small">
                {r.highlights.slice(0, 2).map((h, i) => (
                  <div key={i} style={{ marginTop: 4 }}>
                    {h.texts.map((t, j) =>
                      t.type === "hit" ? (
                        <mark key={j}>{t.value}</mark>
                      ) : (
                        <span key={j}>{t.value}</span>
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              {(r.tags || []).slice(0, 6).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
