"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";
import { resolveWorkspaceId } from "../lib/workspace";

export default function HomePage() {
  const [workspace, setWorkspace] = useState(null);
  const [count, setCount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const wsId = await resolveWorkspaceId();
        if (!wsId) {
          setError(
            "No workspace found. Run `npm run seed` in /backend to create one.",
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

  return (
    <div>
      <h1>Knowledge Base Platform</h1>
      <p className="muted">
        A MongoDB-first knowledge management system. Articles, embeddings,
        search history, and permissions all live in one cluster — no separate
        vector database.
      </p>

      {error && <div className="error">{error}</div>}

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
          <h3>Search modes</h3>
          <ul className="muted small" style={{ paddingLeft: "1.1rem" }}>
            <li>
              <strong>Keyword</strong> — Atlas Search with fuzzy matching
            </li>
            <li>
              <strong>Semantic</strong> — Atlas Vector Search on chunk
              embeddings
            </li>
            <li>
              <strong>Hybrid</strong> — Reciprocal Rank Fusion of both
            </li>
            <li>
              <strong>Ask AI</strong> — RAG-style retrieval for natural
              questions
            </li>
          </ul>
          <Link href="/search">
            <button className="ghost">Try search →</button>
          </Link>
        </div>
      </div>

      <h2>What lives in MongoDB</h2>
      <div className="card">
        <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
          <li>Users, workspaces, members, roles</li>
          <li>Articles with tags, categories, visibility, status</li>
          <li>Article chunks with 1024-dim embeddings (voyage-3)</li>
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
