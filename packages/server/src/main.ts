// `pnpm dev` runs this after building the web app. `--port 0` picks a free
// port. `--source <kind>=fixture|live|window`, once per connector, says how
// its connections are made (decision 0049). The fixture is its synthetic
// data, as its declaration loads it. Live reads the `.env` names its
// connector declares, and `--option <kind>.<name>=<value>` sets its options,
// such as Jira's project; one `.env` can't make is made in the window
// instead, if its connector can be. Window is the person connecting it in
// the window, and the connection is kept for the next start: its options in
// the database, and its secret in a file of its own, in the gitignored
// `secrets/` folder named for the database, such as `secrets/window/`. One
// kept in `secrets/jira.json` before connections moves there at the first
// start. Jira is its SYN fixture, read-only, unless a flag says otherwise;
// a connector no flag names is made in the window if it can be, as the
// folder is, and is off otherwise, as Slack is. Live writes go through
// approved change sets, as `.env`'s account, to the throwaway Jira site and
// only the Slack channels picked.
//
// `--jira`, `--slack`, `--project` and `--channels` are aliases, until the
// scripts that use them move: `--jira live --project OA` is `--source
// jira=live --option jira.project=OA`, and `--slack live --channels a,b` is
// `--source slack=live --option slack.channels=a,b`.
//
// The database is a file under the gitignored `.oriel/`, one per set of
// modes, so fixture items, those of what `.env` names and those connected in
// the window never mix. `--fresh <name>` keeps the run's database under
// `.oriel/fresh/<name>/` and its connections' secrets under
// `secrets/fresh/<name>/`, so a timed first run starts from nothing and
// leaves the usual ones alone.
//
// The agent runs on the model key in `.env` when there is one. Without one, it
// runs on the person's own Claude Code, found on the PATH or at
// `--claude-code <path>`, signed in however they signed it in (decision
// 0037). Settings, kept in `.oriel/settings.json`, can pick another, a model,
// or a path to the CLI (decision 0041). With neither, each turn says how to
// set one up. `--agent scripted` runs the scripted agent instead, which needs
// no model.
//
// `--desktop --data <dir>` is the server as the desktop app's shell starts
// it, and takes no other flag: see desktop/PROTOCOL.md. In the app it runs
// on the shell's own Node, as Electron's utility process, and the channel
// is messages on its parent port (decision 0047); elsewhere, stdin and
// stdout. Jira is connected from the window and kept in the OS secret
// store, and Slack is off. The agent runs on the person's own Claude Code,
// found on the PATH the shell gives, or on an API key set in Settings and
// kept in the same store, and never on `.env`'s key, which is `pnpm dev`'s
// (decision 0036).
// Settings are kept in the data folder. Nothing but the channel to the shell
// goes to stdout.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { findDeno } from "@oriel/sandbox";
import { webFiles, serve } from "./serve.ts";
import { isAbsolute, join } from "node:path";
import { anthropicKey } from "@oriel/agent";
import type { Log } from "@oriel/core";
import { declarationOf, sourceKinds } from "@oriel/sources";
import type { SourceMode } from "./app.ts";
import { keyStore } from "./api-key.ts";
import { fileSecrets, legacyFile } from "./connection.ts";
import { databaseName, inWindow } from "./modes.ts";
import { models as findModels } from "./model.ts";
import { settingsFile } from "./settings.ts";
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
    option: { type: "string", multiple: true },
    jira: { type: "string" },
    project: { type: "string" },
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
const parent = parentPort();
const pipes = !values.desktop
  ? null
  : parent
    ? portPipes(parent)
    : { input: process.stdin, write: takeStdout(process.stdout, process.stderr) };
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
const fresh = values.fresh;
if (fresh !== undefined && !/^[a-z0-9-]+$/.test(fresh)) {
  console.error("--fresh names a run in lowercase letters, digits and dashes");
  process.exit(2);
}
// Each connector's mode, from `--source` and its aliases; Jira's fixture
// unless one names Jira.
const asked = new Map<string, "fixture" | "live" | "window">();
const ask = (kind: string, mode: string, flag: string) => {
  const declaration = declarationOf(kind);
  if (!declaration) {
    console.error(`${flag}: no connector is called ${kind}; there are ${sourceKinds.join(", ")}`);
    process.exit(2);
  }
  if (asked.has(kind)) {
    console.error(`${flag}: ${kind}'s mode is given twice`);
    process.exit(2);
  }
  if (
    !(mode === "fixture" || mode === "live" || mode === "window") ||
    (mode === "live" && !declaration.live) ||
    (mode === "window" && !declaration.connect)
  ) {
    console.error(`${flag}: ${declaration.name} can't be ${mode}`);
    process.exit(2);
  }
  asked.set(kind, mode);
};
for (const each of values.source ?? []) {
  const [, kind = "", mode = ""] = /^([a-z][a-z0-9]*)=([a-z]+)$/.exec(each) ?? [];
  if (!kind) {
    console.error(`--source takes <kind>=fixture|live|window, got ${JSON.stringify(each)}`);
    process.exit(2);
  }
  ask(kind, mode, "--source");
}
if (values.jira !== undefined) ask("jira", values.jira, "--jira");
if (values.slack !== undefined) ask("slack", values.slack, "--slack");
if (!asked.has("jira")) asked.set("jira", "fixture");
// Each live connection's options, by kind, as text its connector reads.
const optionsOf = new Map<string, Record<string, string>>();
const option = (kind: string, name: string, value: string, flag: string) => {
  if (asked.get(kind) !== "live") {
    console.error(`${flag} sets a live connection's options: give --source ${kind}=live too`);
    process.exit(2);
  }
  optionsOf.set(kind, { ...optionsOf.get(kind), [name]: value });
};
for (const each of values.option ?? []) {
  const [, kind = "", name = "", value = ""] =
    /^([a-z][a-z0-9]*)\.([a-z][A-Za-z0-9]*)=(.*)$/s.exec(each) ?? [];
  if (!kind) {
    console.error(`--option takes <kind>.<name>=<value>, got ${JSON.stringify(each)}`);
    process.exit(2);
  }
  option(kind, name, value, "--option");
}
if (values.project !== undefined) option("jira", "project", values.project, "--project");
if (values.channels !== undefined) option("slack", "channels", values.channels, "--channels");

if (values.agent !== "auto" && values.agent !== "scripted") {
  console.error("--agent must be auto or scripted");
  process.exit(2);
}

const files = webFiles();
if (!existsSync(join(files.dist, files.entry))) {
  console.error("The web app isn't built. Run `pnpm dev`, or `pnpm --filter @oriel/web build`.");
  process.exit(1);
}

if (pipes && values.data) {
  // On the shell's Node, nothing the server starts is in a group the shell
  // can kill, so the server ends it all itself, and its watcher does when
  // the server can't.
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
  // Logs go to stderr, which the shell keeps in a file.
  const desktop = await runDesktop({
    data: values.data,
    input: pipes.input,
    write: pipes.write,
    log: (message, fields) => console.error(JSON.stringify({ message, ...fields })),
    signals: process,
    firstPort,
    firstDoorPort,
    async model(secrets) {
      const log: Log = (message, fields) => console.error(JSON.stringify({ message, ...fields }));
      const data = values.data ?? "";
      const settings = settingsFile(join(data, "settings.json"), log);
      const store = keyStore(secrets, log);
      // The CLI is found on the PATH the shell gave, and where Anthropic's
      // installer puts it (decision 0038). A Claude Code from that installer
      // runs only once Anthropic's signature on it checks out.
      const home = process.env.HOME ?? homedir();
      const env = { ...process.env, PATH: withLocalBin(process.env.PATH ?? "", home) };
      const trust =
        process.platform === "darwin"
          ? installerTrust({ home, verify: (path) => anthropicSigned(path) })
          : async () => null;
      const counts = usageFile(join(data, "usage.json"), log);
      const models = findModels({ key: null, kept: store, env, trust, desktop: true, counts });
      const state = setupFile(join(data, "setup.json"));
      const fresh = !state.existed && !existsSync(join(data, "oriel.db"));
      // Not awaited here: the key comes from the shell, which answers once
      // the server listens. Requests wait for it instead.
      const first = models.look(settings.get());
      looked = first.then(() => models.describe(settings.get()));
      return {
        models,
        settings,
        keys: { store },
        looked: first,
        setup: { state, fresh, home, env, trust },
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
const envFile = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
const env = envFile ? parseEnv(envFile) : {};
// Each connector's mode as asked. A live one `.env` can't make is made in
// the window, if its connector can be, and stops the start otherwise.
const modes: Record<string, SourceMode> = {};
const notFromEnv = new Map<string, string>();
for (const [kind, mode] of asked) {
  if (mode !== "live") {
    modes[kind] = { mode };
    continue;
  }
  const declaration = declarationOf(kind);
  if (!declaration?.live) throw new Error(`${kind} can't be live`);
  // Only the names it declares.
  const given = Object.fromEntries(
    declaration.live.env.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const made = declaration.live.connection(given, optionsOf.get(kind) ?? {});
  if ("problem" in made) {
    if (!declaration.connect) {
      console.error(made.problem);
      process.exit(1);
    }
    notFromEnv.set(kind, made.problem);
    modes[kind] = { mode: "window" };
    continue;
  }
  modes[kind] = { mode: "live", ...made };
}
// Oriel's own clients of sources, such as Google's, each from the `.env`
// names its connector declares, and no others.
const clients = Object.fromEntries(
  sourceKinds.flatMap((kind) => {
    const needs = declarationOf(kind)?.connect?.client;
    if (!needs) return [];
    return [
      [
        kind,
        Object.fromEntries(
          [...needs.env, ...(needs.optional ?? [])].flatMap((name) =>
            env[name] ? [[name, env[name]]] : [],
          ),
        ),
      ],
    ];
  }),
);
const named = databaseName(
  Object.fromEntries(Object.entries(modes).map(([kind, given]) => [kind, given.mode])),
);

const dir = join(root, ".oriel", ...(fresh ? ["fresh", fresh] : []));
mkdirSync(dir, { recursive: true });
const log: Log = (message, fields) => console.log(JSON.stringify({ message, ...fields }));
// The person's settings, in the data folder. The scripted agent when asked
// for; otherwise the provider and model Settings pick among those found:
// `.env`'s key, the person's Claude Code, their Codex as a preview, or none.
const settings = settingsFile(join(dir, "settings.json"), log);
const claudeCodePath = values["claude-code"];
const models =
  values.agent === "scripted"
    ? null
    : findModels({
        key: anthropicKey(envFile),
        ...(claudeCodePath ? { claudeCodePath } : {}),
        counts: usageFile(join(dir, "usage.json"), log),
      });
await models?.look(settings.get());
// The MCP door's port, kept beside the database it serves, and never moved.
const doorFile = `${named}.mcp-port`;
const serving = await serve(
  port,
  {
    db: join(dir, `${named}.db`),
    sources: modes,
    clients,
    ...(inWindow(modes, "jira")
      ? {
          legacyJira: legacyFile(
            join(root, "secrets", ...(fresh ? ["fresh", fresh] : []), "jira.json"),
          ),
        }
      : {}),
    // Each database's connections keep their secrets in a folder named for it
    // (decision 0049).
    secrets: fileSecrets(join(root, "secrets", ...(fresh ? ["fresh", fresh] : []), named)),
    ...(models ? { models } : {}),
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
// Each connector, as this start made it.
const shown = serving.app.connections();
for (const kind of sourceKinds) {
  const declaration = declarationOf(kind);
  if (!declaration) continue;
  const open = shown.filter((each) => each.kind === kind && each.state === "open");
  const mode = modes[kind]?.mode ?? (inWindow(modes, kind) ? "window" : null);
  const why = notFromEnv.get(kind);
  console.log(
    mode === null
      ? `${declaration.name}: off. --source ${kind}=fixture reads its fixture.`
      : open.length > 0
        ? `${declaration.name}: ${open.map((each) => each.about).join(", ")}${mode === "fixture" ? ", its fixture" : ""}.`
        : `${declaration.name}: not connected. Connect it from the window${why ? ` (not from .env: ${why})` : ""}.`,
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
