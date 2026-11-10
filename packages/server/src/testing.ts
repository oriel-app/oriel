// Test support: the app over the SYN fixture in an in-memory database, with
// a clock the test moves and a sandbox that runs no Deno: each script is a
// name, and the test says what that name does with the region's real
// bindings. Requests go through the same handler and guard as in production.
// With `writes`, change sets write to SYN as a Jira site in memory, through
// the writer @oriel/changeset builds; nothing here holds a writer. With
// `memory`, the app also syncs from that site, so a test can act in Jira as
// others do. With `jira: false`, no flag makes Jira's connection: it's off
// until it turns on through its source server (decision 0059).
import type { Models } from "./model.ts";
import type { SettingsStore } from "./settings.ts";
import type { Notify } from "./notify.ts";
import type { SetupOptions } from "./setup/setup.ts";
import {
  type Bindings,
  type CapturedMutation,
  type FoundServer,
  type ToolCall,
  type ToolCaller,
  type Instant,
  instant,
  type ProxiedRead,
  type RunResult,
  type Sandbox,
  type TranscriptEntry,
} from "@oriel/core";
import type { JiraFixture } from "@oriel/jira";
import { memorySite, memorySiteOrigin } from "@oriel/jira/testing";
import { atlassianServer, loadJiraFixture } from "@oriel/jira";
import { fixtureGoogle, loadSheetsFixture, sheetsMcpMain, sheetsServer } from "@oriel/sheets";
import { fixtureServer } from "@oriel/sheets/fake";
import { atlassianStandIn, standInCaller } from "@oriel/jira/standin";
import { loadSlackFixture, slackServer } from "@oriel/slack";
import {
  slackStandIn,
  standInCaller as slackStandInCaller,
  standInWorkspace,
} from "@oriel/slack/standin";
import type { Titler } from "@oriel/agent";
import type { ConnectionsView, ConnectionView } from "@oriel/web/view";
import type { Agent, ServerAgentDeps, AgentLimits } from "./agent.ts";
import { type App, type AppOptions, createApp, limits, type SourceMode } from "./app.ts";
import type { OldSecrets } from "./connection.ts";
import { scriptedAgent, type Step } from "./scripted-agent.ts";
import { fakeAgent } from "./servers/testing.ts";
import { handler, type Reply, type Request } from "./site.ts";

export const port = 4310;
export const host = `127.0.0.1:${port}`;
export const origin = `http://${host}`;
// The sketch origin's own port (decision 0033).
export const sketchPort = 4311;
export const sketchOrigin = `http://127.0.0.1:${sketchPort}`;
export const t0 = "2026-10-29T09:00:00.000Z";

// What a named script does: reads through the bindings, and writes captured.
export type Script = (bindings: Bindings) => Promise<{
  value?: unknown;
  // A create names its item: "new:1", then "new:2".
  writes?: [fn: string, args: unknown[], ref?: `new:${number}`][];
  // Oriel's actions, recorded through the bindings.
  intents?: [fn: string, args: unknown[]][];
  // Drafts of the user's actions, recorded through the bindings (decision 0051).
  drafts?: [fn: string, args: unknown[]][];
  logs?: string[];
}>;

// Logs each read and the run's end as the real sandbox does, on the log the
// run was given.
export function fakeSandbox(scripts: Record<string, Script>): Sandbox {
  return {
    async run(script, bindings, { signal, log }) {
      signal.throwIfAborted();
      const named = scripts[script];
      if (!named) throw new Error(`no fake script ${JSON.stringify(script)}`);
      const reads: ProxiedRead[] = [];
      const read: Bindings["read"] = async (fn, args) => {
        const answer = await bindings.read(fn, args);
        reads.push({
          fn,
          args: [...args],
          ms: 1,
          status: "answered",
          outsideRegion: answer.outsideRegion,
          payloadHash: "hash",
        });
        log("sandbox.read", { status: "answered", fn, args, ms: 1 });
        return answer;
      };
      const done = await named({ ...bindings, read });
      const mutations: CapturedMutation[] = (done.writes ?? []).map(([fn, args, ref]) =>
        bindings.capture(fn, args, ref ?? null),
      );
      const intents = (done.intents ?? []).map(([fn, args]) => bindings.intend(fn, args));
      const drafts = (done.drafts ?? []).map(([fn, args]) => bindings.draft(fn, args));
      const transcript: TranscriptEntry[] = [
        ...(done.logs ?? []).map((text) => ({ kind: "log" as const, text })),
        { kind: "return", value: done.value },
      ];
      const result: RunResult = {
        reads,
        mutations,
        intents,
        drafts,
        transcript,
        outcome: "ok",
        wallMs: 5,
        coldStartMs: 2,
      };
      log("sandbox.run", { outcome: "ok", reads: reads.length });
      return result;
    },
  };
}

// Proposes 3 points for the first unestimated story in the region: one
// change set to review.
export const estimate: Script = async (bindings) => {
  const stories = (await bindings.read("jira.listItems", [])).value as {
    id: string;
    gone: boolean;
    points?: number | null;
    issueType?: string;
  }[];
  const story = stories.find((s) => !s.gone && s.points === null && s.issueType !== "Epic");
  if (!story) throw new Error("the region has no unestimated story");
  return { value: [story.id], writes: [["jira.setEstimate", [story.id, 3]]] };
};

export type TestOptions = {
  plan?: (input: Parameters<Agent["turn"]>[0]) => Step[];
  scripts?: Record<string, Script>;
  agent?: (deps: ServerAgentDeps) => Agent;
  // The agent that takes a second look when the person asks; without one,
  // none is offered (decision 0054).
  challenger?: (deps: ServerAgentDeps) => Agent;
  // Writes threads' titles; without one, titles are first messages, clipped.
  titler?: Titler;
  sandbox?: Sandbox;
  limits?: Partial<Pick<AgentLimits, "maxTurnsPerThread" | "maxTokensPerThread">>;
  // Change sets write to SYN in memory instead of being read-only.
  writes?: boolean;
  // Jira is SYN in memory, synced through its API and written to.
  memory?: boolean;
  // No flag makes Jira's connection: it's off until it turns on through
  // its source server.
  jira?: false;
  // A database file, so a second app can open what the first left.
  db?: string;
  // What `pnpm dev` kept of connections' secrets before decision 0059, which
  // the start retires.
  retire?: OldSecrets;
  // Kinds turned on at start through their source servers (`--on`).
  on?: AppOptions["on"];
  // Atlassian's server in the person's agent, its stand-in answering over
  // SYN in memory, which `site` is: Jira turns on through it, as a person
  // turns it on in Settings, with `turnOn("jira")` (decision 0059).
  atlassian?: true;
  // Slack's server in the person's agent, its stand-in answering over the
  // Slack fixture's workspace: Slack turns on through it with
  // `turnOn("slack")`.
  slackServer?: true;
  // sheets-mcp in the person's agent, reading the Sheets fixture's
  // spreadsheets from its stand-in for Google, `sheets`, which a test
  // changes as a person would: Sheets turns on through it with
  // `turnOn("sheets")`.
  sheetsMcp?: true;
  // SYN's issues as its site in memory has them, with no edits; all of them
  // by default. Only that site serves them, so this needs `memory` or
  // `writes`.
  issues?: (syn: JiraFixture["issues"]) => JiraFixture["issues"];
  // Slack, off when absent.
  slack?: SourceMode;
  // Any other connector's mode, as `--source` gives it.
  sources?: AppOptions["sources"];
  // SYN's board in memory takes no estimates: it has no points field.
  estimates?: false;
  // The providers Settings picks among, in place of `agent` and `titler`.
  models?: Models;
  settings?: SettingsStore;
  // The desktop app's notifications and folder picker, through its shell.
  notify?: Notify;
  pickFolder?: (prompt: string) => Promise<string | null>;
  // The desktop app's first run, with stand-ins for what runs.
  setup?: SetupOptions;
  // The person's home folder, which paths show from as `~`.
  home?: string;
  // Whether the page may set where a CLI is, as the desktop app's may.
  cliPaths?: true;
  // What calls a connection's sync every few minutes, in place of a timer.
  every?: AppOptions["every"];
  // What Noticed's pass runs on (decision 0052); nothing, when absent.
  noticer?: AppOptions["noticer"];
  // The person's agent's MCP servers, and the ones Oriel knows (decision
  // 0059); none, when absent.
  discover?: AppOptions["discover"];
  knownServers?: AppOptions["knownServers"];
  // How a sync or a replay calls one of them; nothing, when absent.
  callServer?: AppOptions["callServer"];
};

export type Logged = { message: string; fields: Record<string, unknown> };

export async function testApp(
  t: { after(fn: () => Promise<void>): void },
  options: TestOptions = {},
) {
  let clock = Date.parse(t0);
  const now = (): Instant => instant(new Date(clock));
  const plan = options.plan ?? (() => [{ text: "Hello." }]);
  const syn = loadJiraFixture();
  const served = options.issues ? { ...syn, issues: options.issues(syn.issues), edits: [] } : syn;
  const board = options.estimates === false ? { estimates: false as const } : {};
  const site =
    options.writes || options.memory || options.atlassian ? memorySite(served, now(), board) : null;
  // The person's agent's source servers, as it lists them, and a process of
  // the agent calling one's tools, only those it's allowed: Atlassian's,
  // its stand-in over the site in memory, and sheets-mcp, a fake of its read
  // tools over the Sheets fixture's stand-in for Google.
  const sheetsGoogle = options.sheetsMcp ? fixtureGoogle(loadSheetsFixture()) : null;
  const sheetsReads =
    sheetsGoogle &&
    fixtureServer(
      sheetsGoogle,
      loadSheetsFixture().spreadsheets.map((each) => each.id),
    );
  const atlassian = options.atlassian && site ? standInCaller(atlassianStandIn(site)) : null;
  const slackFixture = options.slackServer ? loadSlackFixture() : null;
  const slackTools =
    slackFixture && slackStandInCaller(slackStandIn(slackFixture, standInWorkspace(slackFixture)));
  const listed: FoundServer[] = [
    ...(slackTools
      ? [
          {
            name: "slack",
            status: "connected" as const,
            reports: "Slack MCP",
            url: "https://mcp.slack.com/mcp",
            command: null,
            tools: [...slackServer.reads, ...slackServer.writes],
            transport: "http" as const,
          },
        ]
      : []),
    ...(atlassian
      ? [
          {
            name: "atlassian",
            status: "connected" as const,
            reports: null,
            url: "https://mcp.atlassian.com/v2/mcp",
            command: null,
            tools: [...atlassianServer.reads, ...atlassianServer.writes],
            transport: "http" as const,
          },
        ]
      : []),
    ...(sheetsReads
      ? [
          {
            name: "sheets",
            status: "connected" as const,
            reports: "sheets-mcp",
            url: null,
            command: `node ${sheetsMcpMain}`,
            tools: [...sheetsServer.reads, ...sheetsServer.writes],
            local: { command: "node", args: [sheetsMcpMain] },
          },
        ]
      : []),
  ];
  const tools = (server: FoundServer): ToolCaller | null =>
    server.name === "atlassian"
      ? atlassian
      : server.name === "slack"
        ? slackTools
        : server.name === "sheets"
          ? (sheetsReads?.read ?? null)
          : null;
  const servers =
    listed.length > 0
      ? {
          discover: fakeAgent(() => listed).discover,
          callServer: async (server: FoundServer, allowed: readonly string[]) => ({
            agent: { id: "codex", name: "Codex", kind: "codex" as const },
            calls: {
              call: async (call: ToolCall) => {
                const calls = tools(server);
                if (!calls || !allowed.includes(call.tool))
                  throw new Error(`${call.tool} isn't allowed`);
                return calls(call);
              },
              close: () => {},
            },
          }),
        }
      : {};
  const jira: SourceMode | null =
    options.jira === false || options.atlassian
      ? null
      : site
        ? options.memory
          ? {
              mode: "memory",
              identity: memorySiteOrigin,
              options: { project: "SYN" },
              fetch: site.fetch,
            }
          : { mode: "fixture", fetch: site.fetch }
        : { mode: "fixture" };
  const logged: Logged[] = [];
  const app: App = await createApp({
    db: options.db ?? ":memory:",
    sources: {
      ...(jira ? { jira } : {}),
      ...(options.slack ? { slack: options.slack } : {}),
      ...options.sources,
    },
    ...(options.retire ? { retire: options.retire } : {}),
    ...(options.on ? { on: options.on } : {}),
    ...(options.every ? { every: options.every } : {}),
    reviewBase: new URL(`${origin}/review/`),
    sketchBase: new URL(`${sketchOrigin}/sketches/`),
    limits: { ...limits, ...options.limits },
    now,
    sandbox: options.sandbox ?? fakeSandbox(options.scripts ?? {}),
    ...(options.models ? { models: options.models } : {}),
    // Models run the agent unless a test gives its own beside them.
    ...(options.models && !options.agent
      ? {}
      : { agent: options.agent ?? ((deps) => scriptedAgent(deps, plan)) }),
    ...(options.challenger ? { challenger: options.challenger } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
    ...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
    ...(options.setup ? { setup: options.setup } : {}),
    ...(options.home ? { home: options.home } : {}),
    ...(options.cliPaths ? { cliPaths: options.cliPaths } : {}),
    themes: ["graphite", "broadsheet"],
    ...(options.titler ? { titler: options.titler } : {}),
    // No pass runs unless a test gives what it runs on.
    noticer: options.noticer ?? (async () => null),
    ...servers,
    ...(options.discover ? { discover: options.discover } : {}),
    ...(options.knownServers ? { knownServers: options.knownServers } : {}),
    ...(options.callServer ? { callServer: options.callServer } : {}),
    log: (message, fields = {}) => logged.push({ message, fields }),
  });
  t.after(() => app.close());
  const handle = handler({
    port,
    dist: "/nonexistent/dist",
    entry: "main.js",
    assets: "/nonexistent/assets",
    vendor: new Map(),
    api: app.api,
    firstRun: app.setup.firstRun,
  });
  const body = (text: string) => async (limit: number) =>
    Buffer.byteLength(text) > limit ? null : text;
  const get = (url: string, headers: Request["headers"] = {}) =>
    handle({ method: "GET", url, headers: { host, ...headers } });
  const post = (url: string, value: unknown = {}, headers: Request["headers"] = {}) =>
    handle({
      method: "POST",
      url,
      headers: { host, origin, "content-type": "application/json", ...headers },
      body: body(JSON.stringify(value)),
    });
  // Every connection as the window lists them, and a kind's first (decision
  // 0049).
  const connections = async () => json<ConnectionsView>(await get("/api/connections"));
  const connection = async (kind: string): Promise<ConnectionView | null> =>
    (await connections()).connections.find((each) => each.kind === kind) ?? null;
  return {
    app,
    site,
    // The Sheets fixture's stand-in for Google behind sheets-mcp, and every
    // call of its tools, with `sheetsMcp`.
    sheets: sheetsGoogle,
    sheetsCalls: sheetsReads?.calls ?? [],
    logged,
    handle,
    body,
    get,
    post,
    connections,
    connection,
    // Connects a kind through its steps, with what the person gave them, as
    // the window does the folder.
    connect: (kind: string, given: unknown) => post("/api/connections", { kind, given }),
    // Turns a kind on through the first server the person's agent lists
    // for it, as a person does in Settings, once its first sync ends.
    async turnOn(kind: string) {
      await post("/api/servers/look");
      const on = await post("/api/actions/source.on", { kind });
      await app.settled();
      return on;
    },
    // A Sync of a kind's connection, as the sidebar's; a 404 when it has none.
    async sync(kind: string) {
      return post(`/api/connections/${(await connection(kind))?.id ?? "0".repeat(26)}/sync`);
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}

// Jira as the window's form reads it from the connections, until one
// component draws every connector's steps (OA-216).
// Jira as its open connection has it, as the tests ask about it.
export type JiraView = {
  connected: { site: string; project: string; items: number; syncedAt: string | null } | null;
  connectable: boolean;
};

export async function jiraOf(app: { connections(): Promise<ConnectionsView> }): Promise<JiraView> {
  const { connections, connectable } = await app.connections();
  const open = connections.find((each) => each.kind === "jira" && each.state === "open");
  return {
    connected: open
      ? {
          site: open.identity,
          project: String(open.options.project),
          items: open.items,
          syncedAt: open.syncedAt,
        }
      : null,
    connectable: connectable.includes("jira"),
  };
}

export function json<T = Record<string, unknown>>(reply: Reply): T {
  return JSON.parse(
    typeof reply.body === "string" ? reply.body : new TextDecoder().decode(reply.body),
  );
}

// What the dispatcher reaches besides workstreams and threads, for a test of
// it that calls none of that but what it `gives`: any other call throws.
export function unreached<T extends object>(what: string, gives: Partial<T> = {}): T {
  return new Proxy(gives as T, {
    get: (given, key) =>
      Object.hasOwn(given, key)
        ? given[key as keyof T]
        : () => {
            throw new Error(`${what}.${String(key)} isn't reached here`);
          },
  });
}
