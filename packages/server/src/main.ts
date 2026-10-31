// `pnpm dev` runs this after building the web app. `--port 0` picks a free
// port. Jira is the frozen SYN fixture, read-only, unless `--jira live`,
// which syncs the throwaway site and writes to it through approved change
// sets. Its credentials come from `.env` if it has them; otherwise the user
// connects Jira from the window, and the connection is kept in the
// gitignored `secrets/jira.json` for the next start. The database is a file
// under the gitignored `.oriel/`, one per Jira mode, so fixture items, those
// of the site `.env` names and those of the one connected in the window
// never mix.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agent, anthropicProvider, anthropicTitler, defaultModel, titleModel } from "@oriel/agent";
import { basicAuth } from "@oriel/jira";
import { webFiles, serve } from "./serve.ts";
import { join } from "node:path";
import type { JiraMode } from "./app.ts";
import { fileStore } from "./connection.ts";
import { serverEnv } from "./env.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4310" },
    jira: { type: "string", default: "fixture" },
    project: { type: "string", default: "SYN" },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`--port must be a port number, got ${JSON.stringify(values.port)}`);
  process.exit(2);
}
if (values.jira !== "fixture" && values.jira !== "live") {
  console.error("--jira must be fixture or live");
  process.exit(2);
}

const files = webFiles();
if (!existsSync(join(files.dist, files.entry))) {
  console.error("The web app isn't built. Run `pnpm dev`, or `pnpm --filter @oriel/web build`.");
  process.exit(1);
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = join(root, ".env");
const env = serverEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
const fromEnv = values.jira === "live" && !("problem" in env.jira) ? env.jira : null;
const jira: JiraMode =
  values.jira === "fixture"
    ? { kind: "fixture" }
    : fromEnv
      ? {
          kind: "live",
          site: fromEnv.site,
          credential: basicAuth(fromEnv.email, fromEnv.token),
          project: values.project,
        }
      : { kind: "window", store: fileStore(join(root, "secrets", "jira.json")) };

// The model-backed agent when `.env` has a model key, which only its
// provider holds; the scripted agent otherwise.
const { modelKey } = env;
const dir = join(root, ".oriel");
mkdirSync(dir, { recursive: true });
const serving = await serve(port, {
  db: join(dir, `${jira.kind}.db`),
  jira,
  ...(modelKey
    ? {
        agent: (deps) => agent({ ...deps, provider: anthropicProvider({ apiKey: modelKey }) }),
        titler: anthropicTitler({ apiKey: modelKey }),
      }
    : {}),
  log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
});
console.log(`Oriel is running at ${serving.url}`);
const shown = serving.app.jira();
console.log(
  jira.kind === "fixture"
    ? "Jira: the SYN fixture, read-only. Change sets can be reviewed; approving says writing isn't configured."
    : shown.connected
      ? `Jira: ${shown.connected.site}, project ${shown.connected.project}. Change sets you approve are written there.`
      : `Jira: not connected. Connect it from the window${"problem" in env.jira ? ` (not from .env: ${env.jira.problem})` : ""}.`,
);
console.log(
  modelKey
    ? `Agent: the model-backed agent (${defaultModel}), with the model key from .env. Thread titles: ${titleModel}.`
    : "Agent: the scripted agent for local development. Set ANTHROPIC_API_KEY in .env for the model-backed one.",
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    serving.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
