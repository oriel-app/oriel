// Nothing here holds a writer: change sets build their own.
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
export const sketchPort = 4311;
export const sketchOrigin = `http://127.0.0.1:${sketchPort}`;
export const t0 = "2026-10-29T09:00:00.000Z";

export type Script = (bindings: Bindings) => Promise<{
  value?: unknown;
  writes?: [fn: string, args: unknown[], ref?: `new:${number}`][];
  intents?: [fn: string, args: unknown[]][];
  drafts?: [fn: string, args: unknown[]][];
  logs?: string[];
}>;

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
  challenger?: (deps: ServerAgentDeps) => Agent;
  titler?: Titler;
  sandbox?: Sandbox;
  limits?: Partial<Pick<AgentLimits, "maxTurnsPerThread" | "maxTokensPerThread">>;
  writes?: boolean;
  memory?: boolean;
  jira?: false;
  db?: string;
  retire?: OldSecrets;
  on?: AppOptions["on"];
  atlassian?: true;
  slackServer?: true;
  sheetsMcp?: true;
  // Only SYN's site in memory serves them, so this needs `memory` or `writes`.
  issues?: (syn: JiraFixture["issues"]) => JiraFixture["issues"];
  slack?: SourceMode;
  sources?: AppOptions["sources"];
  estimates?: false;
  models?: Models;
  settings?: SettingsStore;
  notify?: Notify;
  pickFolder?: (prompt: string) => Promise<string | null>;
  setup?: SetupOptions;
  home?: string;
  cliPaths?: true;
  every?: AppOptions["every"];
  noticer?: AppOptions["noticer"];
  discover?: AppOptions["discover"];
  knownServers?: AppOptions["knownServers"];
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
  const connections = async () => json<ConnectionsView>(await get("/api/connections"));
  const connection = async (kind: string): Promise<ConnectionView | null> =>
    (await connections()).connections.find((each) => each.kind === kind) ?? null;
  return {
    app,
    site,
    sheets: sheetsGoogle,
    sheetsCalls: sheetsReads?.calls ?? [],
    logged,
    handle,
    body,
    get,
    post,
    connections,
    connection,
    connect: (kind: string, given: unknown) => post("/api/connections", { kind, given }),
    async turnOn(kind: string) {
      await post("/api/servers/look");
      const on = await post("/api/actions/source.on", { kind });
      await app.settled();
      return on;
    },
    async sync(kind: string) {
      return post(`/api/connections/${(await connection(kind))?.id ?? "0".repeat(26)}/sync`);
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}

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
