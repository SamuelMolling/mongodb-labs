const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4010";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listArticles: (workspaceId) =>
    request(`/api/articles${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  getArticle: (id) => request(`/api/articles/${id}`),
  createArticle: (body) =>
    request("/api/articles", { method: "POST", body: JSON.stringify(body) }),
  updateArticle: (id, body) =>
    request(`/api/articles/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteArticle: (id) =>
    request(`/api/articles/${id}`, { method: "DELETE" }),

  listWorkspaces: () => request("/api/workspaces"),

  // The single endpoint the UI calls.
  // Composes hybrid (kw + vec) + Voyage rerank server-side.
  smartSearch: (body) =>
    request("/api/search/smart", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // The endpoints below remain so the article can demo each pipeline
  // independently. The user-facing UI does not call them.
  searchKeyword: (body) =>
    request("/api/search/keyword", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  searchSemantic: (body) =>
    request("/api/search/semantic", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  searchHybrid: (body) =>
    request("/api/search/hybrid", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ask: (body) =>
    request("/api/search/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
