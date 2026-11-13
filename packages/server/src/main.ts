// `pnpm dev` runs this after building the web app. `--port 0` picks a free
// port. `--source <kind>=fixture|window`, once per connector, says how its
// connections are made (decision 0049). The fixture is its synthetic data,
// as its declaration loads it. Window is the person connecting it in the
// window, as the folder, and the connection is kept for the next start, in
// the database. Jira is its SYN fixture, read-only, unless a flag says
// otherwise; a connector no flag names is made in the window if it can be,
// as the folder is, and otherwise turns on through its source server in the
// person's agent, from Settings (decision 0059).
//
// `--on <kind>`, once per kind, turns a kind on at start through the server
// the person's agent lists for it, as a click in Settings does: how the
// maintainer dogfoods a real source, such as `--on jira` through
// Atlassian's server, signed in in their own agent (packages/server's
// README). Such a kind has no flag's connection, and its database is
// `live`, as its own connection's was before decision 0059, so what was
// connected there, its options and items, carries over. Writes go through
// approved change sets, through the server's write tools.
//
// The database is a file under the gitignored `.oriel/`, one per set of
// modes, so fixture items and real ones never mix. `--fresh <name>` keeps
// the run's database under `.oriel/fresh/<name>/`, so a timed first run
// starts from nothing and leaves the usual ones alone. What `pnpm dev` kept
// of connections' secrets before decision 0059, in the gitignored
// `secrets/` folder, is deleted at the start (`retire`).
//
// The agent runs on the person's own Claude Code, found on the PATH or at
// `--claude-code <path>`, signed in however they signed it in (decision
// 0037), else on their Codex, as the desktop app does. Settings, kept in
// `.oriel/settings.json`, can pick another, a model, or a path to the CLI
// (decision 0041). With none, each turn says how to set one up. `--agent
// scripted` runs the scripted agent instead, which needs no model. `--agent
// api` runs on the model key in `.env`, and is the only way that key runs
// anything (decision 0059): an API key has no MCP servers, so no source
// turns on through it.
//
// `--desktop --data <dir>` is the server as the desktop app's shell starts
// it, and takes no other flag but `--placeholder-account`, which the shell
// adds when a script started it: see desktop/PROTOCOL.md. In the app it runs
// on the shell's own Node, as Electron's utility process, and the channel
// is messages on its parent port (decision 0047); elsewhere, stdin and
// stdout. Every source turns on through the person's own agent's servers,
// and the folder is connected in the window. The agent runs on the person's
// own Claude Code or Codex, found on the PATH the shell gives, and never on
// an API key (decisions 0036 and 0059). A key an older app kept in the OS
// secret store is deleted as the shell opens it (shell/secrets.ts).
// Settings are kept in the data folder. Nothing but the channel to the shell
// goes to stdout.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findDeno } from "@oriel/sandbox";
import { webFiles, serve } from "./serve.ts";
import { isAbsolute, join } from "node:path";
import { anthropicKey } from "@oriel/agent";
import type { Log } from "@oriel/core";
import { declarationOf, sourceKinds } from "@oriel/sources";
import { oldSecretFiles } from "./connection.ts";
import { devModes, inWindow } from "./modes.ts";
import { models as findModels } from "./model.ts";
import { settingsFile } from "./settings.ts";
import { devStandIns } from "./standins.ts";
import { usageFile } from "./usage.ts";
import { doorPorts, firstDoorPort, firstPort, keepPort, keptPort } from "./desktop/port.ts";
import { runDesktop, Stopped, takeStdout } from "./desktop/run.ts";
import { killDescendants, parentPort, portPipes, watchChildren } from "./desktop/utility.ts";
import { anthropicSigned, installerTrust, withLocalBin } from "./setup/signature.ts";
import { setupFile } from "./setup/state.ts";
import { homedir } from "node:os";

const { values, tokens } = parseArgs({
  options: {
    port: { type: "string", default: "4310" },
    source: { type: "string", multiple: true },
    on: { type: "string", multiple: true },
    fresh: { type: "string" },
    agent: { type: "string", default: "auto" },
    "claude-code": { type: "string" },
    desktop: { type: "boolean" },
    data: { type: "string" },
    "placeholder-account": { type: "boolean" },
  },
  tokens: true,
});
// Taken before anything can write, so the channel's first line is its own.
const parent = parentPort();
const pipes = !values.desktop
  ? null
  : parent
    ? portPipes(parent)
    : { input: process.stdin, write: takeStdout(process.stdout, process.stderr) };
const flags = new Set(tokens.flatMap((token) => (token.kind === "option" ? [token.name] : [])));
const desktopFlags = new Set(["desktop", "data", "placeholder-account"]);
if (values.desktop && [...flags].some((flag) => !desktopFlags.has(flag))) {
  console.error("--desktop takes only --data and --placeholder-account");
  process.exit(2);
}
if (flags.has("placeholder-account") && !values.desktop) {
  console.error("--placeholder-account is for the desktop app's server only");
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
const fresh = values.fresh;
if (fresh !== undefined && !/^[a-z0-9-]+$/.test(fresh)) {
  console.error("--fresh names a run in lowercase letters, digits and dashes");
  process.exit(2);
}
const dev = devModes(values.source ?? [], values.on ?? []);
if ("problem" in dev) {
  console.error(dev.problem);
  process.exit(2);
}
const { modes, on, database: named } = dev;

if (values.agent !== "auto" && values.agent !== "scripted" && values.agent !== "api") {
  console.error("--agent must be auto, scripted or api");
  process.exit(2);
}

const files = webFiles();
if (!existsSync(join(files.dist, files.entry))) {
  console.error("The web app isn't built. Run `pnpm dev`, or `pnpm --filter @oriel/web build`.");
  process.exit(1);
}

if (pipes && values.data) {
  // On the shell's Node, nothing the server starts is in a group the shell can kill, so the server ends it all itself,
  // and its watcher does when the server can't.
  if (parent) {
    process.on("exit", killDescendants);
    const log: Log = (message, fields) => console.error(JSON.stringify({ message, ...fields }));
    try {
      watchChildren(findDeno(), log);
    } catch (error) {
      log("watcher: no Deno to run it on", { error: String(error) });
    }
  }
  let looked: Promise<string> = Promise.resolve("");
  const desktop = await runDesktop({
    data: values.data,
    input: pipes.input,
    write: pipes.write,
    log: (message, fields) => console.error(JSON.stringify({ message, ...fields })),
    signals: process,
    firstPort,
    firstDoorPort,
    async model() {
      const log: Log = (message, fields) => console.error(JSON.stringify({ message, ...fields }));
      const data = values.data ?? "";
      const settings = settingsFile(join(data, "settings.json"), log);
      // A Claude Code from Anthropic's installer runs only once Anthropic's signature on it checks out.
      const home = process.env.HOME ?? homedir();
      const env = { ...process.env, PATH: withLocalBin(process.env.PATH ?? "", home) };
      const trust =
        process.platform === "darwin"
          ? installerTrust({ home, verify: (path) => anthropicSigned(path) })
          : async () => null;
      const counts = usageFile(join(data, "usage.json"), log);
      const models = findModels({ key: null, env, trust, desktop: true, counts });
      const state = setupFile(join(data, "setup.json"));
      const fresh = !state.existed && !existsSync(join(data, "oriel.db"));
      // Not awaited here: requests wait for it instead.
      const first = models.look(settings.get());
      looked = first.then(() => models.describe(settings.get()));
      return {
        models,
        settings,
        looked: first,
        setup: {
          state,
          fresh,
          home,
          env,
          trust,
          placeholder: values["placeholder-account"] === true,
        },
      };
    },
  }).catch((error: unknown) => {
    if (error instanceof Stopped) process.exit(0);
    console.error(
      `Oriel's server couldn't start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  });
  console.error(`Oriel is running at ${desktop.serving.url}`);
  console.error(await looked);
  process.exit(await desktop.exited);
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = join(root, ".env");
// Read only for the model key (`anthropicKey`), and only under `--agent
// api`: no connection comes from it.
const envFile =
  values.agent === "api" && existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
const key = anthropicKey(envFile);
if (values.agent === "api" && key === null) {
  console.error("--agent api runs on ANTHROPIC_API_KEY in .env, and .env has none");
  process.exit(2);
}

const dir = join(root, ".oriel", ...(fresh ? ["fresh", fresh] : []));
mkdirSync(dir, { recursive: true });
const log: Log = (message, fields) => console.log(JSON.stringify({ message, ...fields }));
const settings = settingsFile(join(dir, "settings.json"), log);
const claudeCodePath = values["claude-code"];
// In dev only: the desktop app's start above never reads this.
const standIns = devStandIns(process.env.ORIEL_DEV_STANDINS);
const models =
  values.agent === "scripted"
    ? null
    : findModels({
        key,
        ...(claudeCodePath ? { claudeCodePath } : {}),
        counts: usageFile(join(dir, "usage.json"), log),
        ...(standIns ? { dev: standIns.dev } : {}),
      });
await models?.look(settings.get());
const doorFile = `${named}.mcp-port`;
const serving = await serve(
  port,
  {
    db: join(dir, `${named}.db`),
    sources: modes,
    ...(on.length ? { on } : {}),
    retire: oldSecretFiles(join(root, "secrets")),
    ...(models ? { models } : {}),
    ...(standIns ? { knownServers: standIns.known } : {}),
    settings,
    log,
  },
  {
    door: {
      ports: port === 0 ? [0] : doorPorts(keptPort(dir, doorFile), firstDoorPort),
      listening: (at) => {
        if (port !== 0) keepPort(dir, at, doorFile);
      },
    },
  },
);
console.log(`Oriel is running at ${serving.url}`);
console.log(
  "url" in serving.door
    ? `Oriel's MCP door, for outside tools: ${serving.door.url}`
    : `Oriel's MCP door is closed. ${serving.door.closed}`,
);
const shown = serving.app.connections();
for (const kind of sourceKinds) {
  const declaration = declarationOf(kind);
  if (!declaration || declaration.standIn) continue;
  const open = shown.filter((each) => each.kind === kind && each.state === "open");
  const mode = modes[kind]?.mode ?? (inWindow(modes, kind) ? "window" : null);
  console.log(
    open.length > 0
      ? `${declaration.name}: ${open.map((each) => each.about).join(", ")}${mode === "fixture" ? ", its fixture" : ""}.`
      : on.includes(kind)
        ? `${declaration.name}: not on. Is its server in your agent, signed in? See packages/server/README.md.`
        : mode === "window"
          ? `${declaration.name}: not connected. Connect it from the window.`
          : `${declaration.name}: off. Turn it on in Settings, or --source ${kind}=fixture reads its fixture.`,
  );
}
console.log(
  models?.describe(settings.get()) ?? "Agent: the scripted agent, as --agent scripted asked.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    serving.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
