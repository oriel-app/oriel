// `pnpm dev` runs this after building the web app. `--port 0` picks a free
// port. Jira is the frozen SYN fixture, read-only, unless `--jira live`,
// which syncs the throwaway site and writes to it through approved change
// sets, with the credentials in `.env`. The database is a file under the
// gitignored `.oriel/`, one per Jira mode, so fixture and live items never mix.
//
// Slack is off unless `--slack fixture`, the synthetic workspace, or
// `--slack live --channels a,b`, which reads those public channels, by name
// or ID, as the first person in `.env`'s SLACK_USER_TOKENS. Either is
// read-only.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agent, anthropicProvider, anthropicTitler, defaultModel, titleModel } from "@oriel/agent";
import { basicAuth } from "@oriel/jira";
import { bearer } from "@oriel/slack";
import { webFiles, serve } from "./serve.ts";
import { join } from "node:path";
import type { JiraMode, SlackMode } from "./app.ts";
import { serverEnv, slackEnv } from "./env.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4310" },
    jira: { type: "string", default: "fixture" },
    project: { type: "string", default: "SYN" },
    slack: { type: "string" },
    channels: { type: "string" },
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
if (values.slack !== undefined && values.slack !== "fixture" && values.slack !== "live") {
  console.error("--slack must be fixture or live");
  process.exit(2);
}
const channels = (values.channels ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
if ((values.slack === "live") !== channels.length > 0) {
  console.error("--channels names the channels --slack live reads, and only then");
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
let jira: JiraMode = { kind: "fixture" };
if (values.jira === "live") {
  if ("problem" in env.jira) {
    console.error(env.jira.problem);
    process.exit(1);
  }
  jira = {
    kind: "live",
    site: env.jira.site,
    credential: basicAuth(env.jira.email, env.jira.token),
    project: values.project,
  };
}

let slack: SlackMode | null = values.slack === "fixture" ? { kind: "fixture" } : null;
if (values.slack === "live") {
  const found = slackEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  if ("problem" in found) {
    console.error(found.problem);
    process.exit(1);
  }
  slack = { kind: "live", credential: bearer(found.token), channels };
}

// The model-backed agent when `.env` has a model key, which only its
// provider holds; the scripted agent otherwise.
const { modelKey } = env;
const dir = join(root, ".oriel");
mkdirSync(dir, { recursive: true });
const serving = await serve(port, {
  db: join(dir, `${jira.kind}.db`),
  jira,
  ...(slack ? { slack } : {}),
  ...(modelKey
    ? {
        agent: (deps) => agent({ ...deps, provider: anthropicProvider({ apiKey: modelKey }) }),
        titler: anthropicTitler({ apiKey: modelKey }),
      }
    : {}),
  log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
});
console.log(`Oriel is running at ${serving.url}`);
console.log(
  jira.kind === "fixture"
    ? "Jira: the SYN fixture, read-only. Change sets can be reviewed; approving says writing isn't configured."
    : `Jira: ${jira.site}, project ${jira.project}. Change sets you approve are written there.`,
);
console.log(
  slack === null
    ? "Slack: off. --slack fixture reads the synthetic channel."
    : slack.kind === "fixture"
      ? "Slack: the synthetic channel, read-only."
      : `Slack: ${channels.map((name) => `#${name.replace(/^#/, "")}`).join(", ")}, read-only.`,
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
