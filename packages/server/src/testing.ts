// Test support: the app over the SYN fixture in an in-memory database, with
// a clock the test moves and a sandbox that runs no Deno: each script is a
// name, and the test says what that name does with the region's real
// bindings. Requests go through the same handler and guard as in production.
// With `writes`, change sets write to SYN as a Jira site in memory, through
// the writer @oriel/changeset builds; nothing here holds a writer. With
// `connect`, Jira starts unconnected, and the window connects it to SYN in
// memory, which answers only `account`.
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
import { memorySite, memorySiteOrigin } from "@oriel/jira/testing";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import type { Titler } from "@oriel/agent";
import type { Agent, ServerAgentDeps, AgentLimits } from "./agent.ts";
import { type App, createApp, type JiraMode, limits } from "./app.ts";
import type { ConnectionStore } from "./connection.ts";
import { scriptedAgent, type Step } from "./scripted-agent.ts";
import { handler, type Reply, type Request } from "./site.ts";

export const port = 4310;
export const host = `127.0.0.1:${port}`;
export const origin = `http://${host}`;
export const t0 = "2026-10-29T09:00:00.000Z";

// What a named script does: reads through the bindings, and writes captured.
export type Script = (bindings: Bindings) => Promise<{
  value?: unknown;
  // A create names its item: "new:1", then "new:2".
  writes?: [fn: string, args: unknown[], ref?: `new:${number}`][];
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
      const transcript: TranscriptEntry[] = [
        ...(done.logs ?? []).map((text) => ({ kind: "log" as const, text })),
        { kind: "return", value: done.value },
      ];
      const result: RunResult = {
        reads,
        mutations,
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
  // A database file, so a second app can open what the first left.
  db?: string;
  // Jira is connected from the window, and kept in `store`.
  connect?: { store: ConnectionStore };
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
  const site = options.connect
    ? memorySite(loadJiraFixture(), now(), { account })
    : options.writes
      ? memorySite(loadJiraFixture(), now())
      : null;
  const jira: JiraMode = options.connect
    ? { kind: "window", store: options.connect.store, ...(site ? { fetch: site.fetch } : {}) }
    : site
      ? {
          kind: "fixture",
          writeTo: {
            site: memorySiteOrigin,
            credential: { headers: async () => ({}) },
            project: "SYN",
            fetch: site.fetch,
          },
        }
      : { kind: "fixture" };
  const logged: Logged[] = [];
  const app: App = await createApp({
    db: options.db ?? ":memory:",
    jira,
    reviewBase: new URL(`${origin}/review/`),
    limits: { ...limits, ...options.limits },
    now,
    sandbox: options.sandbox ?? fakeSandbox(options.scripts ?? {}),
    agent: options.agent ?? ((deps) => scriptedAgent(deps, plan)),
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
    window: app.window,
    api: app.api,
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
  return {
    app,
    site,
    logged,
    handle,
    body,
    get,
    post,
    advance(ms: number) {
      clock += ms;
    },
  };
}

export function json<T = Record<string, unknown>>(reply: Reply): T {
  return JSON.parse(
    typeof reply.body === "string" ? reply.body : new TextDecoder().decode(reply.body),
  );
}
