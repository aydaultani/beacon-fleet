import { parseArgs } from "node:util";
import { startServer } from "./server/index.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4317" },
    host: { type: "string", default: "127.0.0.1" },
  },
});

const port = Number.parseInt(values.port ?? "4317", 10);
const host = values.host ?? "127.0.0.1";

await startServer({ port, host });
