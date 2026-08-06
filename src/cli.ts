import { parseArgs } from "node:util";
import open from "open";
import { startServer } from "./server/index.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4317" },
    host: { type: "string", default: "127.0.0.1" },
    "no-open": { type: "boolean", default: false },
  },
});

const port = Number.parseInt(values.port ?? "4317", 10);
const host = values.host ?? "127.0.0.1";

const { app, url } = await startServer({ port, host });

if (!values["no-open"]) {
  await open(url).catch(() => {
    // Headless environment or no default browser — the URL is already
    // printed above, nothing more useful to do here.
  });
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down...`);
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
