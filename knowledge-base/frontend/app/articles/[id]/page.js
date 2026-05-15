"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../lib/api";

export default function ArticleViewPage() {
  const { id } = useParams();
  const router = useRouter();
  const [article, setArticle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setArticle(await api.getArticle(id));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [id]);

  async function handleDelete() {
    if (!confirm("Delete this article (and its chunks)?")) return;
    await api.deleteArticle(id);
    router.push("/articles");
  }

  if (error) return <div className="error">{error}</div>;
  if (!article) return <p className="muted">Loading…</p>;

  return (
    <article>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>{article.title}</h1>
        <div className="row">
          <Link href={`/articles/${id}/edit`}>
            <button className="ghost">Edit</button>
          </Link>
          <button className="danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {article.summary && <p className="muted">{article.summary}</p>}

      <div style={{ marginBottom: "1rem" }}>
        {(article.tags || []).map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
        {article.category && (
          <span className="tag" style={{ background: "#243049" }}>
            {article.category}
          </span>
        )}
      </div>

      <pre className="content">{article.content}</pre>

      <p className="muted small">
        Created {new Date(article.createdAt).toLocaleString()} · Updated{" "}
        {new Date(article.updatedAt).toLocaleString()}
      </p>
    </article>
  );
}
