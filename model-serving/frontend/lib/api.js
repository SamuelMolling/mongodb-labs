const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4030";

export const SERVING_URLS = (process.env.NEXT_PUBLIC_SERVING_URLS || "http://localhost:8031,http://localhost:8032")
  .split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Errors carry the HTTP status so the UI can treat 409 differently: a 409 is
 * "someone changed this deployment since you loaded it", and the right
 * reaction is to refresh and show what changed -- not to retry.
 */
async function request(url, options = {}) {
  // Headers only on writes: a GET with custom headers costs a CORS preflight
  // on every poll.
  const write = options.method && options.method !== "GET";
  const res = await fetch(url, {
    ...options,
    headers: write ? { "Content-Type": "application/json", "X-Actor": "ui", ...(options.headers || {}) } : options.headers,
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(body?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.details = body?.details;
    throw err;
  }
  return body;
}

const get = (p) => request(`${API}${p}`);
const post = (p, b) => request(`${API}${p}`, { method: "POST", body: JSON.stringify(b) });
const dep = (modelId, env = "prod") => `/api/deployments/${encodeURIComponent(modelId)}/${env}`;

export const api = {
  listModels: () => get("/api/models"),
  model: (id) => get(`/api/models/${encodeURIComponent(id)}`),

  deployment: (m) => get(dep(m)),
  history: (m) => get(`${dep(m)}/history?limit=30`),
  fleet: (m) => get(`${dep(m)}/fleet`),
  metrics: (m, minutes) => get(`${dep(m)}/metrics?minutes=${minutes}`),
  timeline: (m, minutes) => get(`${dep(m)}/timeline?minutes=${minutes}`),
  drift: (m, minutes) => get(`${dep(m)}/drift?minutes=${minutes}`),
  accuracy: (m, minutes) => get(`${dep(m)}/accuracy?minutes=${minutes}`),
  alerts: (m) => get(`${dep(m)}/alerts`),

  promote: (m, body) => post(`${dep(m)}/promote`, body),
  rollback: (m, body) => post(`${dep(m)}/rollback`, body),
  canary: (m, body) => post(`${dep(m)}/canary`, body),
  shadow: (m, body) => post(`${dep(m)}/shadow`, body),

  predict: (nodeUrl, modelId, body) =>
    request(`${nodeUrl}/predict/${encodeURIComponent(modelId)}`, { method: "POST", body: JSON.stringify(body) }),
};
