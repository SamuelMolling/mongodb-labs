"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { resolveWorkspaceId } from "../../lib/workspace";

export default function AskPage() {
  const [workspaceId, setWorkspaceId] = useState(null);
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    resolveWorkspaceId().then(setWorkspaceId);
  }, []);

  async function handleAsk(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setContext([]);
    try {
      const res = await api.ask({ question, workspaceId, topK: 5 });
      setContext(res.context);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Ask AI</h1>
      <p className="muted">
        Ask a natural-language question. The backend runs Atlas Vector Search
        to retrieve relevant chunks, then reranks them with Voyage rerank-2.
        These passages are the context you would feed to an LLM to generate
        the final answer.
      </p>

      <form onSubmit={handleAsk}>
        <div className="row" style={{ marginTop: "1rem" }}>
          <input
            placeholder="What is Reciprocal Rank Fusion and why use it?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ flex: 1, minWidth: 300 }}
          />
          <button type="submit" disabled={loading}>
            {loading && <span className="spinner" />}
            Ask
          </button>
        </div>
      </form>

      {error && <div className="error" style={{ marginTop: "1rem" }}>{error}</div>}

      {context.length > 0 && (
        <>
          <h2>Retrieved context ({context.length} passages)</h2>
          <p className="muted small">
            Each passage is a chunk returned by{" "}
            <code className="mono">$vectorSearch</code>, post-reranked. The
            articleId links to the original document.
          </p>
          {context.map((c, i) => (
            <div key={i} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <Link href={`/articles/${c.articleId}`}>
                  <strong>{c.title}</strong>
                </Link>
                <span className="result-score">
                  vec={c.score?.toFixed(3)}
                  {c.rerankScore !== undefined &&
                    ` rerank=${c.rerankScore.toFixed(3)}`}
                </span>
              </div>
              <p className="small" style={{ margin: "0.5rem 0" }}>
                {c.text}
              </p>
              <div>
                {(c.tags || []).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
