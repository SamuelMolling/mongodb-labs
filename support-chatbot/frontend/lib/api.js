const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4020";

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
  listCustomers: () => request("/api/customers"),

  knowledgeGaps: () => request("/api/admin/knowledge-gaps"),
  metrics: () => request("/api/admin/metrics"),

  sendFeedback: (body) =>
    request("/api/chat/feedback", { method: "POST", body: JSON.stringify(body) }),

  /**
   * One agent turn, consumed as NDJSON.
   *
   * The pipeline runs four remote calls before the first token, so the stream
   * carries `state` events describing where it is. That is what the inspector
   * panel renders — the point of the lab is watching the stages, not just the
   * answer.
   *
   *   onState      pipeline stage changed (condensing, tools, retrieving, ...)
   *   onPassages   the retrieved passages, before generation starts
   *   onToken      one text delta
   *   onEscalation a handoff packet was written
   *   onDone       final turn metadata
   *   onError      mid-stream failure
   */
  chatStream: async (body, handlers = {}) => {
    const res = await fetch(`${API}/api/chat`, {
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
        if (evt.event === "state") handlers.onState?.(evt);
        else if (evt.event === "passages") handlers.onPassages?.(evt);
        else if (evt.event === "token") handlers.onToken?.(evt.text);
        else if (evt.event === "escalation") handlers.onEscalation?.(evt);
        else if (evt.event === "done") handlers.onDone?.(evt);
        else if (evt.event === "error") handlers.onError?.(evt.message);
      }
    }
  },
};
