"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { resolveWorkspaceId } from "../../lib/workspace";

const EXAMPLES = [
  "How do I chunk documents by markdown section?",
  "When should I use keyword vs vector search?",
  "Why not just sum the scores from two rankers?",
  "What input_type do I use for the user's query?",
];

export default function SearchPage() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";

  const [workspaceId, setWorkspaceId] = useState(null);
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    resolveWorkspaceId().then((wsId) => {
      setWorkspaceId(wsId);
      // If we arrived with ?q=..., run that search automatically.
      if (initialQ && wsId) {
        runSearchInternal(initialQ, wsId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearchInternal(q, wsId) {
    setQuery(q);
    setLoading(true);
    setError(null);
    setResults([]);
    setMeta(null);
    try {
      const res = await api.smartSearch({ query: q, workspaceId: wsId, limit: 8 });
      setResults(res.results);
      setMeta({ count: res.results.length });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(q) {
    const text = (q ?? query).trim();
    if (!text) return;
    await runSearchInternal(text, workspaceId);
  }

  return (
    <div>
      <h1>Search the knowledge base</h1>
      <p className="muted">
        Ask anything. The backend runs hybrid retrieval (keyword + vector)
        and reranks the passages with Voyage AI before returning them.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="row" style={{ marginTop: "1rem" }}>
          <input
            placeholder="e.g. how do I chunk by section?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            style={{ flex: 1, minWidth: 300, fontSize: "1.05rem" }}
          />
          <button type="submit" disabled={loading || !workspaceId}>
            {loading && <span className="spinner" />}
            Search
          </button>
        </div>
      </form>

      {!loading && results.length === 0 && !error && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted small" style={{ margin: 0, marginBottom: 8 }}>
            Try:
          </p>
          <div className="row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                className="ghost"
                onClick={() => runSearch(ex)}
                style={{ fontSize: 13 }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="error" style={{ marginTop: "1rem" }}>
          {error}
        </div>
      )}

      {meta && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          {meta.count} passage{meta.count === 1 ? "" : "s"} ·{" "}
          <span className="mono">hybrid + rerank</span>
        </p>
      )}

      <div style={{ marginTop: ".5rem" }}>
        {results.map((r, i) => (
          <article key={r._id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href={`/articles/${r.articleId}`}>
                <strong style={{ fontSize: "1.05rem" }}>{r.title}</strong>
              </Link>
              <span className="result-score" title="Voyage rerank-2 relevance score">
                #{i + 1} · {(r.rerankScore ?? 0).toFixed(3)}
              </span>
            </div>

            {r.summary && (
              <p className="muted small" style={{ margin: "0.4rem 0 0" }}>
                {r.summary}
              </p>
            )}

            <pre
              className="content"
              style={{
                marginTop: "0.6rem",
                marginBottom: "0.4rem",
                fontSize: 13.5,
              }}
            >
              {r.text}
            </pre>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                {(r.tags || []).slice(0, 6).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <span className="small muted">
                chunk #{r.chunkIndex}
                {r.kwMatch ? " · keyword + vector match" : " · vector match"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
