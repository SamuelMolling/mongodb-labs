import express from "express";
import cors from "cors";

import models from "./routes/models.js";
import deployments from "./routes/deployments.js";
import outcomes from "./routes/outcomes.js";

/**
 * Builds the Express app WITHOUT touching MongoDB.
 *
 * The split from index.js is what makes the HTTP layer testable offline: the
 * smoke test boots this on an ephemeral port and checks routing and the
 * validation that must run before any database call (a promotion without
 * expectedRevision has to fail with 400 before it gets near a transaction).
 *
 * Handlers call getDB() lazily, so importing them needs no connection.
 */
export function createApp() {
  const app = express();

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
  app.use(express.json({ limit: "5mb" })); // a version's baseline travels in the body

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/models", models);
  app.use("/api/deployments/:modelId/:env", deployments);
  app.use("/api", outcomes);

  app.use((req, res) => res.status(404).json({ error: `no route for ${req.method} ${req.path}` }));

  // Centralised error handler — keeps each route file terse.
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error("[error]", err);
    res.status(status).json({
      error: err.message || "Internal server error",
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  });

  return app;
}
