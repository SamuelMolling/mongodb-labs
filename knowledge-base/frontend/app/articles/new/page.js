"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArticleForm } from "../../../components/ArticleForm";
import { api } from "../../../lib/api";
import { resolveWorkspaceId } from "../../../lib/workspace";

export default function NewArticlePage() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(null);
  const [authorId, setAuthorId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const wsId = await resolveWorkspaceId();
        setWorkspaceId(wsId);
        // For the demo workspace, the owner is the author.
        const wsList = await api.listWorkspaces();
        const ws = wsList.find((w) => w._id === wsId);
        if (ws) setAuthorId(ws.ownerId);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  async function handleSubmit(values) {
    if (!workspaceId || !authorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createArticle({
        workspaceId,
        authorId,
        ...values,
      });
      router.push(`/articles/${created._id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>New article</h1>
      {error && <div className="error">{error}</div>}
      <ArticleForm onSubmit={handleSubmit} submitting={submitting} />
    </div>
  );
}
