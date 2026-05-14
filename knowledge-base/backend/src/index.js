import "dotenv/config";
import express from "express";
import cors from "cors";

import { connectDB, closeDB } from "./db.js";
import users from "./routes/users.js";
import workspaces from "./routes/workspaces.js";
import articles from "./routes/articles.js";
import search from "./routes/search.js";

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
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/users", users);
app.use("/api/workspaces", workspaces);
app.use("/api/articles", articles);
app.use("/api/search", search);

// Centralised error handler — keeps each route file terse.
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

const port = Number(process.env.PORT) || 4010;

connectDB()
  .then(() => {
    app.listen(port, () =>
      console.log(`[server] listening on http://localhost:${port}`),
    );
  })
  .catch((err) => {
    console.error("[startup] failed to connect to MongoDB:", err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\n[server] received ${signal}, shutting down`);
    await closeDB();
    process.exit(0);
  });
}
