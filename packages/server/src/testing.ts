// Test support: the app over the SYN fixture in an in-memory database, with
// a clock the test moves and a sandbox that runs no Deno: each script is a
// name, and the test says what that name does with the region's real
// bindings. Requests go through the same handler and guard as in production.
// With `writes`, change sets write to SYN as a Jira site in memory, through
// the writer @oriel/changeset builds; nothing here holds a writer. With
// `live`, the app also syncs from that site, as from a live one. With
// `connect`, Jira starts unconnected, and the window connects it to SYN in
// memory, which answers only `account`.
import type { Models } from "./model.ts";
import type { SettingsStore } from "./settings.ts";
import type { Notify } from "./notify.ts";
import type { SetupOptions } from "./setup/setup.ts";
import {
  type Bindings,
  type CapturedMutation,
  type Instant,
  instant,
  type ProxiedRead,
  type RunResult,
  type Sandbox,
  type TranscriptEntry,
} from "@oriel/core";
import type { JiraFixture } from "@oriel/jira";
import { memorySite, memorySiteOrigin } from "@oriel/jira/testing";
import { loadJiraFixture } from "@oriel/jira";
import type { Titler } from "@oriel/agent";
import type { ConnectionsView, ConnectionView, JiraView } from "@oriel/web/view";
import type { Agent, ServerAgentDeps, AgentLimits } from "./agent.ts";
import { type App, type AppOptions, createApp, limits, type SourceMode } from "./app.ts";
import type { LegacyJira, Secrets } from "./connection.ts";
import { scriptedAgent, type Step } from "./scripted-agent.ts";
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
  // Writes threads' titles; without one, titles are first messages, clipped.
  titler?: Titler;
  sandbox?: Sandbox;
  limits?: Partial<Pick<AgentLimits, "maxTurnsPerThread" | "maxTokensPerThread">>;
  // Change sets write to SYN in memory instead of being read-only.
  writes?: boolean;
  // Jira is SYN in memory, synced through its API and written to.
  live?: boolean;
  // A database file, so a second app can open what the first left.
  db?: string;
  // Jira is connected from the window, and its connection's secret kept in
  // `secrets`, in memory when absent; `legacy` is a connection saved before
  // connections, which the start moves.
  connect?: { secrets?: Secrets; legacy?: LegacyJira };
  // SYN's issues as its site in memory has them, with no edits; all of them
  // by default. Only that site serves them, so this needs `connect` or `live`.
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
  // Where the page keeps an API key, as on the desktop app.
  keys?: AppOptions["keys"];
  // The desktop app's notifications and folder picker, through its shell.
  notify?: Notify;
  pickFolder?: (prompt: string) => Promise<string | null>;
  // The desktop app's first run, with stand-ins for what runs.
  setup?: SetupOptions;
  // Any Jira Cloud site may be connected, as on the desktop app.
  anySite?: boolean;
};

// The account SYN in memory answers when the window connects it.
export const account = { email: "pm@example.com", token: "memory-site-secret-value" };

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
  const site = options.connect
    ? memorySite(served, now(), { account, ...board })
    : options.writes || options.live
      ? memorySite(served, now(), board)
      : null;
  const jira: SourceMode = options.connect
    ? { mode: "window", ...(site ? { fetch: site.fetch } : {}) }
    : site
      ? options.live
        ? {
            mode: "live",
            identity: memorySiteOrigin,
            options: { project: "SYN" },
            secret: JSON.stringify({ email: "", token: "" }),
            fetch: site.fetch,
          }
        : { mode: "fixture", fetch: site.fetch }
      : { mode: "fixture" };
  const logged: Logged[] = [];
  const app: App = await createApp({
    db: options.db ?? ":memory:",
    sources: { jira, ...(options.slack ? { slack: options.slack } : {}), ...options.sources },
    ...(options.connect?.legacy ? { legacyJira: options.connect.legacy } : {}),
    ...(options.anySite ? { anywhere: true } : {}),
    ...(options.connect?.secrets ? { secrets: options.connect.secrets } : {}),
    reviewBase: new URL(`${origin}/review/`),
    sketchBase: new URL(`${sketchOrigin}/sketches/`),
    limits: { ...limits, ...options.limits },
    now,
    sandbox: options.sandbox ?? fakeSandbox(options.scripts ?? {}),
    ...(options.models
      ? { models: options.models }
      : { agent: options.agent ?? ((deps) => scriptedAgent(deps, plan)) }),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.keys ? { keys: options.keys } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
    ...(options.pickFolder ? { pickFolder: options.pickFolder } : {}),
    ...(options.setup ? { setup: options.setup } : {}),
    themes: ["graphite", "broadsheet"],
    ...(options.titler ? { titler: options.titler } : {}),
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
    logged,
    handle,
    body,
    get,
    post,
    connections,
    connection,
    // Connects a kind through its steps, with what the person gave them, as
    // the window does.
    connect: (kind: string, given: unknown) => post("/api/connections", { kind, given }),
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
