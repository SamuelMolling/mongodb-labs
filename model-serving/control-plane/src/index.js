import "./env.js";

import { createApp } from "./app.js";
import { connectDB, closeDB } from "./db.js";
import { startMonitor, stopMonitor } from "./monitor.js";

/**
 * Process entrypoint: connect, start the scheduled check, serve.
 * Everything else is built in app.js without a database.
 */
const app = createApp();
const port = Number(process.env.CONTROL_PLANE_PORT) || 4030;

connectDB()
  .then(() => {
    app.listen(port, () => console.log(`[control-plane] listening on http://localhost:${port}`));
    startMonitor(Number(process.env.MONITOR_INTERVAL_SEC ?? 60));
  })
  .catch((err) => {
    console.error("[startup] failed to connect to MongoDB:", err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\n[control-plane] received ${signal}, shutting down`);
    stopMonitor();
    await closeDB();
    process.exit(0);
  });
}
