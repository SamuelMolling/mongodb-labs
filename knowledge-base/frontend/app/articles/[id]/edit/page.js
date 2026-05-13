"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArticleForm } from "../../../../components/ArticleForm";
import { api } from "../../../../lib/api";

export default function EditArticlePage() {
  const { id } = useParams();
  const router = useRouter();
  const [article, setArticle] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setArticle(await api.getArticle(id));
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [id]);

  async function handleSubmit(values) {
    setSubmitting(true);
    setError(null);
    try {
      await api.updateArticle(id, values);
      router.push(`/articles/${id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!article) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Edit article</h1>
      <ArticleForm
        initial={article}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}
