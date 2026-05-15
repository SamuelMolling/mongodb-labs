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

  // Smart search returns passages as a single JSON response.
  smartSearch: (body) =>
    request("/api/search/smart", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // RAG with a streaming LLM answer. Calls /api/search/chat, which retrieves
  // passages and then streams an LLM answer back as NDJSON events.
  //
  // Usage:
  //   await api.chatStream({ question, workspaceId, limit }, {
  //     onPassages: (p)     => ...,
  //     onToken:    (text)  => ...,
  //     onDone:     (info)  => ...,
  //     onError:    (msg)   => ...,
  //     signal:     ac.signal,   // optional AbortController.signal
  //   });
  chatStream: async (body, handlers = {}) => {
    const res = await fetch(`${API}/api/search/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });

    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.event === "passages") handlers.onPassages?.(evt.passages);
        else if (evt.event === "token") handlers.onToken?.(evt.text);
        else if (evt.event === "done") handlers.onDone?.(evt);
        else if (evt.event === "error") handlers.onError?.(evt.message);
      }
    }
  },

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
