import express from "express";
import cors from "cors";

import chat from "./routes/chat.js";
import conversations from "./routes/conversations.js";
import customers from "./routes/customers.js";
import admin from "./routes/admin.js";

/**
 * Builds the Express app WITHOUT touching MongoDB.
 *
 * The split from index.js is what makes the HTTP layer testable offline: the
 * smoke test boots this on an ephemeral port and exercises routing,
 * middleware and validation with no cluster and no API keys. Wiring bugs --
 * a route mounted at the wrong path, a validation check that runs after the
 * expensive call instead of before it -- are the cheapest class of bug to
 * catch and the most annoying to catch in production.
 *
 * Route handlers call getDB() lazily inside the handler, so importing them
 * here does not require a connection.
 */
export function createApp() {
  const app = express();

  /**
   * CORS_ORIGIN can be:
   *   - empty / "*"                → allow any origin (default)
   *   - "localhost"                → allow any http://localhost:PORT, handy for dev
   *     with multiple Next.js apps competing for ports
   *   - "https://my.app,https://x" → comma-separated allow-list
   *   - a single origin string     → matched exactly
   */
  const corsRaw = (process.env.CORS_ORIGIN || "*").trim();
  const corsOrigin =
    corsRaw === "*" || corsRaw === ""
      ? "*"
      : corsRaw === "localhost"
      ? (origin, cb) => {
          if (!origin) return cb(null, true); // curl, server-to-server
          cb(null, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
        }
      : corsRaw.split(",").map((o) => o.trim());

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/chat", chat);
  app.use("/api/conversations", conversations);
  app.use("/api/customers", customers);
  app.use("/api/admin", admin);

  // Centralised error handler — keeps each route file terse.
  app.use((err, _req, res, _next) => {
    console.error("[error]", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  });

  return app;
}
