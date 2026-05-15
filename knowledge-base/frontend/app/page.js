"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import { resolveWorkspaceId } from "../lib/workspace";

const QUICK_QUERIES = [
  "How do I chunk by markdown section?",
  "Why store embeddings in the same database?",
  "Voyage rerank-2 pipeline",
];

export default function HomePage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const wsId = await resolveWorkspaceId();
        if (!wsId) {
          setError(
            "No workspace found. Run `make seed` in the project root to create one.",
          );
          return;
        }
        const list = await api.listArticles(wsId);
        setWorkspace(wsId);
        setCount(list.length);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  function goSearch(q) {
    const text = (q ?? query).trim();
    if (!text) return;
    router.push(`/search?q=${encodeURIComponent(text)}`);
  }

  return (
    <div>
      <h1>Knowledge Base</h1>
      <p className="muted">
        Ask anything and find the exact passage that answers you. Operational
        data, embeddings, and search all live in one MongoDB Atlas cluster.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            goSearch();
          }}
        >
          <div className="row">
            <input
              placeholder="Ask the knowledge base…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 300, fontSize: "1.05rem" }}
            />
            <button type="submit" disabled={!workspace}>Search</button>
          </div>
        </form>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 6 }}>
          Or try one of these:
        </p>
        <div className="row">
          {QUICK_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              className="ghost"
              style={{ fontSize: 13 }}
              onClick={() => goSearch(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: "1.5rem" }}>
        <div className="card">
          <h3>Workspace</h3>
          <p className="mono small muted">{workspace || "loading…"}</p>
          <p>{count !== null ? `${count} article(s)` : ""}</p>
          <Link href="/articles">
            <button className="ghost">Browse articles →</button>
          </Link>
        </div>

        <div className="card">
          <h3>What happens when you search</h3>
          <ol
            className="muted small"
            style={{ paddingLeft: "1.1rem", margin: 0 }}
          >
            <li>Atlas Search ranks articles by keyword (BM25 + fuzzy)</li>
            <li>Atlas Vector Search ranks chunks by embedding similarity</li>
            <li>Reciprocal Rank Fusion merges the two rankings</li>
            <li>Voyage rerank-2 picks the most relevant passages</li>
          </ol>
          <p className="muted small" style={{ marginTop: 10 }}>
            All four stages run inside one aggregation flow on the same
            MongoDB cluster.
          </p>
        </div>
      </div>

      <h2>What lives in MongoDB</h2>
      <div className="card">
        <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
          <li>Users, workspaces, members, roles</li>
          <li>Articles with tags, categories, visibility, status</li>
          <li>
            Article chunks (split by markdown section) with 1024-dim
            embeddings (voyage-3)
          </li>
          <li>Search history for analytics</li>
          <li>
            Two Atlas indexes: <code className="mono">articles_search</code>{" "}
            (full-text) and <code className="mono">chunks_vector</code>{" "}
            (vector)
          </li>
        </ul>
      </div>
    </div>
  );
}
