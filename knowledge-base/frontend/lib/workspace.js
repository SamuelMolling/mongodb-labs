"use client";

import { api } from "./api";

const ENV_WS = process.env.NEXT_PUBLIC_WORKSPACE_ID || "";

/**
 * Resolves a workspace id at runtime.
 *
 * Priority:
 *   1. ?workspaceId=... in the URL
 *   2. NEXT_PUBLIC_WORKSPACE_ID env var (set via .env.local)
 *   3. localStorage cache from a previous resolution
 *   4. First workspace returned by the API (seed creates one)
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

  const cached = localStorage.getItem("workspaceId");
  if (cached) return cached;

  const list = await api.listWorkspaces();
  if (list.length > 0) {
    localStorage.setItem("workspaceId", list[0]._id);
    return list[0]._id;
  }
  return null;
}
