"use client";

import { useState } from "react";

export function ArticleForm({ initial = {}, onSubmit, submitting }) {
  const [title, setTitle] = useState(initial.title || "");
  const [content, setContent] = useState(initial.content || "");
  const [summary, setSummary] = useState(initial.summary || "");
  const [tagsText, setTagsText] = useState((initial.tags || []).join(", "));
  const [category, setCategory] = useState(initial.category || "");

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      title,
      content,
      summary,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      category: category || null,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="card">
        <label className="small muted">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="How to use MongoDB Atlas Vector Search"
          required
          style={{ marginTop: 4, marginBottom: 12 }}
        />

        <label className="small muted">Summary</label>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One-line description"
          style={{ marginTop: 4, marginBottom: 12 }}
        />

        <div className="grid-2">
          <div>
            <label className="small muted">Tags (comma separated)</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="mongodb, atlas, tutorial"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <label className="small muted">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="tutorial / guide / reference"
              style={{ marginTop: 4 }}
            />
          </div>
        </div>

        <label className="small muted" style={{ marginTop: 12, display: "block" }}>
          Content (markdown supported on display)
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your article…"
          required
          style={{ marginTop: 4 }}
        />

        <div className="row" style={{ marginTop: 16 }}>
          <button type="submit" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? "Saving + embedding…" : "Save article"}
          </button>
          <span className="muted small">
            Saving will chunk the content and generate embeddings via Voyage AI.
          </span>
        </div>
      </div>
    </form>
  );
}
