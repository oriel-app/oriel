// `pnpm dev` runs this after building the web app. `--port 0` picks a free
// port. Jira is the frozen SYN fixture, read-only, unless `--jira live`,
// which syncs the throwaway site and writes to it through approved change
// sets. Its credentials come from `.env` if it has them; otherwise the user
// connects Jira from the window, and the connection is kept in the
// gitignored `secrets/jira.json` for the next start. The database is a file
// under the gitignored `.oriel/`, one per Jira mode, so fixture items, those
// of the site `.env` names and those of the one connected in the window
// never mix. `--jira window` ignores `.env`'s Jira credentials, so the user
// connects from the window as a new user does. `--fresh <name>` keeps the
// run's database under `.oriel/fresh/<name>/` and its saved connection under
// `secrets/fresh/<name>/`, so a timed first run starts from nothing and
// leaves the usual ones alone.
//
// Slack is off unless `--slack fixture`, the synthetic workspace, or
// `--slack live --channels a,b`, which reads those public channels, by name
// or ID, as the first person in `.env`'s SLACK_USER_TOKENS. Change sets a
// person approves post as that person, only in those channels: in memory for
// the fixture, and in Slack for live, which needs the chat:write scope.
//
// The agent runs on the model key in `.env` when there is one. Without one, it
// runs on the person's own Claude Code, found on the PATH or at
// `--claude-code <path>`, signed in however they signed it in (decision
// 0037). With neither, each turn says how to set one up. `--agent scripted`
// runs the scripted agent instead, which needs no model.
//
// `--desktop --data <dir>` is the server as the desktop app's shell starts
// it, and takes no other flag: see desktop/PROTOCOL.md. Jira is connected
// from the window and kept in the OS's store for secrets, and Slack is off.
// The agent runs on the person's own Claude Code, found on the PATH the shell
// gives, and never on `.env`'s key, which is `pnpm dev`'s (decision 0036).
// Nothing but the channel to the shell goes to stdout.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { basicAuth } from "@oriel/jira";
import { bearer } from "@oriel/slack";
import { webFiles, serve } from "./serve.ts";
import { isAbsolute, join } from "node:path";
import type { JiraMode, SlackMode } from "./app.ts";
import { fileStore } from "./connection.ts";
import { serverEnv, slackEnv } from "./env.ts";
import { chooseModel, modelOptions } from "./model.ts";
import { firstPort } from "./desktop/port.ts";
import { runDesktop, Stopped, takeStdout } from "./desktop/run.ts";

const { values, tokens } = parseArgs({
  options: {
    port: { type: "string", default: "4310" },
    jira: { type: "string", default: "fixture" },
    project: { type: "string", default: "SYN" },
    slack: { type: "string" },
    channels: { type: "string" },
    fresh: { type: "string" },
    agent: { type: "string", default: "auto" },
    "claude-code": { type: "string" },
    desktop: { type: "boolean" },
    data: { type: "string" },
  },
  tokens: true,
});
// Taken before anything can write, so the channel's first line is its own.
const channelWrite = values.desktop ? takeStdout(process.stdout, process.stderr) : null;
const flags = new Set(tokens.flatMap((token) => (token.kind === "option" ? [token.name] : [])));
if (values.desktop && [...flags].some((flag) => flag !== "desktop" && flag !== "data")) {
  console.error("--desktop takes only --data");
  process.exit(2);
}
if ((values.desktop === true) !== flags.has("data")) {
  console.error("--data names the desktop app's data folder, and only with --desktop");
  process.exit(2);
}
if (values.desktop && !isAbsolute(values.data ?? "")) {
  console.error("--data must be an absolute path");
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error(`--port must be a port number, got ${JSON.stringify(values.port)}`);
  process.exit(2);
}
if (values.jira !== "fixture" && values.jira !== "live" && values.jira !== "window") {
  console.error("--jira must be fixture, live or window");
  process.exit(2);
}
const fresh = values.fresh;
if (fresh !== undefined && !/^[a-z0-9-]+$/.test(fresh)) {
  console.error("--fresh names a run in lowercase letters, digits and dashes");
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

if (values.agent !== "auto" && values.agent !== "scripted") {
  console.error("--agent must be auto or scripted");
  process.exit(2);
}

const files = webFiles();
if (!existsSync(join(files.dist, files.entry))) {
  console.error("The web app isn't built. Run `pnpm dev`, or `pnpm --filter @oriel/web build`.");
  process.exit(1);
}

if (channelWrite && values.data) {
  const model = modelOptions(await chooseModel({ key: null }));
  // Logs go to stderr, which the shell keeps in a file.
  const desktop = await runDesktop({
    data: values.data,
    input: process.stdin,
    write: channelWrite,
    log: (message, fields) => console.error(JSON.stringify({ message, ...fields })),
    signals: process,
    firstPort,
    app: {
      ...(model.agent ? { agent: model.agent } : {}),
      ...(model.titler ? { titler: model.titler } : {}),
    },
  }).catch((error: unknown) => {
    if (error instanceof Stopped) process.exit(0);
    console.error(
      `Oriel's server couldn't start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  });
  console.error(`Oriel is running at ${desktop.serving.url}`);
  console.error(model.describe);
  process.exit(await desktop.exited);
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
      : {
          kind: "window",
          store: fileStore(join(root, "secrets", ...(fresh ? ["fresh", fresh] : []), "jira.json")),
        };

let slack: SlackMode | null = values.slack === "fixture" ? { kind: "fixture" } : null;
if (values.slack === "live") {
  const found = slackEnv(existsSync(envPath) ? readFileSync(envPath, "utf8") : null);
  if ("problem" in found) {
    console.error(found.problem);
    process.exit(1);
  }
  slack = { kind: "live", credential: bearer(found.token), channels };
}

// The scripted agent when asked for; otherwise the model `.env`'s key or the
// person's Claude Code gives, or none.
const claudeCodePath = values["claude-code"];
const model =
  values.agent === "scripted"
    ? null
    : modelOptions(
        await chooseModel({
          key: env.modelKey,
          ...(claudeCodePath ? { claudeCode: { path: claudeCodePath } } : {}),
        }),
      );
const dir = join(root, ".oriel", ...(fresh ? ["fresh", fresh] : []));
mkdirSync(dir, { recursive: true });
const serving = await serve(port, {
  db: join(dir, `${jira.kind}.db`),
  jira,
  ...(slack ? { slack } : {}),
  ...(model?.agent ? { agent: model.agent } : {}),
  ...(model?.titler ? { titler: model.titler } : {}),
  log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
});
console.log(`Oriel is running at ${serving.url}`);
const shown = serving.app.jira();
console.log(
  jira.kind === "fixture"
    ? "Jira: the SYN fixture, read-only. Change sets can be reviewed; approving says writing isn't configured."
    : shown.connected
      ? `Jira: ${shown.connected.site}, project ${shown.connected.project}. Change sets you approve are written there.`
      : `Jira: not connected. Connect it from the window${values.jira === "live" && "problem" in env.jira ? ` (not from .env: ${env.jira.problem})` : ""}.`,
);
console.log(
  slack === null
    ? "Slack: off. --slack fixture reads the synthetic channel."
    : slack.kind === "fixture"
      ? "Slack: the synthetic channel. Change sets you approve post there, in memory."
      : `Slack: ${channels.map((name) => `#${name.replace(/^#/, "")}`).join(", ")}. Change sets you approve post there as the person Oriel reads Slack as.`,
);
console.log(model?.describe ?? "Agent: the scripted agent, as --agent scripted asked.");

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    serving.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
