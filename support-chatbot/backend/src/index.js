import "dotenv/config";

import { createApp } from "./app.js";
import { connectDB, closeDB } from "./db.js";

/**
 * Process entrypoint: connect to MongoDB, then serve.
 *
 * All the app construction lives in app.js so it can be built without a
 * database. This file owns exactly the two things that need a real
 * environment: the connection and the socket.
 */
const app = createApp();
const port = Number(process.env.PORT) || 4020;

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
