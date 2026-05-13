import "dotenv/config";
import express from "express";
import cors from "cors";

import { connectDB, closeDB } from "./db.js";
import users from "./routes/users.js";
import workspaces from "./routes/workspaces.js";
import articles from "./routes/articles.js";
import search from "./routes/search.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
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

const port = Number(process.env.PORT) || 8080;

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
