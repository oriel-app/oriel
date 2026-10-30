// Test support: the app over the SYN fixture in an in-memory database, with
// a clock the test moves and a sandbox that runs no Deno: each script is a
// name, and the test says what that name does with the region's real
// bindings. Requests go through the same handler and guard as in production.
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
import type { Agent, AgentDeps } from "./agent.ts";
import { type App, createApp } from "./app.ts";
import { scriptedAgent, type Step } from "./scripted-agent.ts";
import { handler, type Reply, type Request } from "./site.ts";

export const port = 4310;
export const host = `127.0.0.1:${port}`;
export const origin = `http://${host}`;
export const t0 = "2026-10-29T09:00:00.000Z";

// What a named script does: reads through the bindings, and writes captured.
export type Script = (bindings: Bindings) => Promise<{
  value?: unknown;
  writes?: [fn: string, args: unknown[]][];
  logs?: string[];
}>;

export function fakeSandbox(scripts: Record<string, Script>): Sandbox {
  return {
    async run(script, bindings, { signal }) {
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
        return answer;
      };
      const done = await named({ ...bindings, read });
      const mutations: CapturedMutation[] = (done.writes ?? []).map(([fn, args]) =>
        bindings.capture(fn, args, null),
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
      return result;
    },
  };
}

export type TestOptions = {
  plan?: (input: Parameters<Agent["turn"]>[0]) => Step[];
  scripts?: Record<string, Script>;
  agent?: (deps: AgentDeps) => Agent;
};

export async function testApp(
  t: { after(fn: () => Promise<void>): void },
  options: TestOptions = {},
) {
  let clock = Date.parse(t0);
  const now = (): Instant => instant(new Date(clock));
  const plan = options.plan ?? (() => [{ text: "Hello." }]);
  const app: App = await createApp({
    db: ":memory:",
    jira: { kind: "fixture" },
    reviewBase: new URL(`${origin}/review/`),
    now,
    sandbox: fakeSandbox(options.scripts ?? {}),
    agent: options.agent ?? ((deps) => scriptedAgent(deps, plan)),
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
