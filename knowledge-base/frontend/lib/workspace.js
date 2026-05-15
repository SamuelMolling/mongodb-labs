"use client";

import { api } from "./api";

const ENV_WS = process.env.NEXT_PUBLIC_WORKSPACE_ID || "";

/**
 * Resolves a workspace id at runtime.
 *
 * Priority:
 *   1. ?workspaceId=... in the URL (always wins; refreshes the cache)
 *   2. NEXT_PUBLIC_WORKSPACE_ID env var (set via .env.local)
 *   3. localStorage cache — but only if the ID still exists on the server
 *   4. First workspace returned by the API
 *
 * Validating cached IDs prevents the "0 articles" stale-cache trap when the
 * seed has been re-run and old workspaces have been dropped.
 */
export async function resolveWorkspaceId() {
  if (typeof window === "undefined") return ENV_WS || null;

  const fromUrl = new URLSearchParams(window.location.search).get(
    "workspaceId",
  );
  if (fromUrl) {
    localStorage.setItem("workspaceId", fromUrl);
    return fromUrl;
  }

  if (ENV_WS) return ENV_WS;

  // We hit the server anyway to validate the cached id, so listWorkspaces is
  // the cheapest single call that gets both validation and a fallback.
  const list = await api.listWorkspaces();
  const validIds = new Set(list.map((w) => w._id));

  const cached = localStorage.getItem("workspaceId");
  if (cached && validIds.has(cached)) return cached;

  // Cached id is stale (or missing) — fall back to the first workspace
  // and rewrite the cache so the next page load is fast.
  if (cached) localStorage.removeItem("workspaceId");
  if (list.length > 0) {
    localStorage.setItem("workspaceId", list[0]._id);
    return list[0]._id;
  }
  return null;
}
