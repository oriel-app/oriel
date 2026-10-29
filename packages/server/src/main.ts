// `pnpm dev` runs this after building the web app. `--port 0` picks a free port.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serve, webSite } from "./serve.ts";

const { values } = parseArgs({ options: { port: { type: "string", default: "4310" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`--port must be a port number, got ${JSON.stringify(values.port)}`);
  process.exit(2);
}

const site = webSite();
if (!existsSync(join(site.dist, site.entry))) {
  console.error("The web app isn't built. Run `pnpm dev`, or `pnpm --filter @oriel/web build`.");
  process.exit(1);
}

const { url } = await serve(port, site);
console.log(`Oriel is running at ${url}`);
