import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * The whole lab shares ONE .env at the lab root (model-serving/.env): the
 * control plane, the serving nodes, the trainer and the load generator all
 * need the same MONGODB_URI. Import this module first in every entrypoint.
 */
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
