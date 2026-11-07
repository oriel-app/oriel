// The person's own Codex as a `Provider` and a `Titler` (decision 0048), a
// preview beside Claude Code (decision 0037). Oriel starts `codex app-server`
// for each turn, over its stdin and stdout, signed in however the person
// signed it in, and gives it Oriel's constant system prompt in place of
// Codex's own and one client tool, `run`, whose calls come back over the
// same pipe.
//
// Synced content reaches this process, so it is locked down as far as Codex
// lets it be: every feature switch that gives the model a tool or loads
// something of the person's off, each MCP server and skill Codex reports off
// for the thread, the read-only sandbox with no network, an approval policy
// that sends every command and file change to Oriel, which declines it, an
// empty temporary working directory, and an allowlisted environment. Codex
// still loads the person's own `config.toml`, and it can't report the tools
// it gives the model, so what it does report at thread start is checked, and
// any item but a message, its reasoning or a `run` call stops the turn.
// Oriel never reads Codex's credentials or changes its configuration: flags,
// the thread's own settings and environment only.
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";
import type { FoundServer, Log } from "@oriel/core";
import type { Effort } from "./anthropic.ts";
import {
  type HarnessProblem,
  historyCallId,
  historyScript,
  historyText,
  locateCli,
  passedEnv,
  type PlanUsage,
  type PlanWindow,
  type Spawn,
} from "./claude-code.ts";
import { runToolName } from "./prompt.ts";
import {
  type Conversation,
  type ConversationRequest,
  type ModelEvent,
  noUsage,
  type Provider,
  ProviderError,
  type ToolSpec,
  type Usage,
} from "./provider.ts";
import { type Titler, titleFrom, titlePrompt } from "./title.ts";

// The Codex this was verified against, and the major version after it, which
// Oriel refuses until it's checked: a release can add a tool Oriel doesn't
// know to turn off.
export const codexMinVersion = "0.166.0";
const codexMaxMajor = 0;

export type Codex = { path: string; version: string };

// A model the person's Codex offers, from its own list.
export type CodexModel = { id: string; label: string; isDefault: boolean };

// The plan and the account's email, as Codex's `account/read` says them:
// shown in the row, never stored. `personal`: signed in with a ChatGPT plan
// that isn't a Business, Enterprise or Edu one, which OpenAI may train on if
// the person allowed it; never for an API key.
export type CodexAccount = { plan: string | null; email: string | null; personal: boolean };

// ChatGPT plans OpenAI doesn't train on by default. Team is Business's old
// name.
const commercialPlans = ["team", "business", "enterprise", "edu"];

const spawnCli: Spawn = (command, args, options) =>
  spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });

// Every feature switch Codex 0.166.0 has that gives the model a tool, loads
// something of the person's or reaches past the turn: shells, images, goals,
// sub-agents, plugins, apps, skills, hooks, memories, browsers, computer use
// and the rest. A name Codex doesn't know stops it starting, so a release
// that drops one fails closed. Code mode's host stays on: the models a
// ChatGPT plan serves reach client tools, `run` among them, only through its
// `exec`, a JavaScript isolate with no files, network or console.
export const codexFeaturesOff = [
  "apps",
  "browser_annotation_api",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "daemon_auto_start",
  "goals",
  "guardian_approval",
  "hooks",
  "image_generation",
  "in_app_browser",
  "in_app_chat",
  "in_app_dictation",
  "in_app_local_automation",
  "in_app_updates",
  "in_app_voice",
  "memories",
  "mentions_v2",
  "multi_agent",
  "plugin_discovery_prefetch",
  "plugin_sharing",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "sleep_tool",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "unified_exec_tty",
  "view_image",
  "workspace_dependencies",
] as const;

// Configuration Oriel sets on the command line, which outranks the person's
// `config.toml` (but not a company's managed configuration, which the thread
// start's report is checked against): no web search, no instructions files,
// no skills, no notify command, no developer instructions, no history, no
// update check, no analytics, and a shell environment of nothing.
export const codexConfig = [
  'web_search="disabled"',
  "project_doc_max_bytes=0",
  "include_permissions_instructions=false",
  "include_apps_instructions=false",
  "include_environment_context=false",
  "include_collaboration_mode_instructions=false",
  "skills.include_instructions=false",
  "skills.bundled.enabled=false",
  "notify=[]",
  'developer_instructions=""',
  'history.persistence="none"',
  "check_for_update_on_startup=false",
  "analytics.enabled=false",
  "feedback.enabled=false",
  'shell_environment_policy.inherit="none"',
] as const;

// The command line. `overrides`: more `-c` settings, for the live test's
// stand-in model only; the server never passes any.
export function codexArgs(overrides: readonly string[] = []): string[] {
  return [
    "app-server",
    ...codexFeaturesOff.flatMap((feature) => ["--disable", feature]),
    ...[...codexConfig, ...overrides].flatMap((setting) => ["-c", setting]),
  ];
}

// The person's own variables from the harness's allowlist, with
// `CODEX_HOME` in place of Claude Code's config directory. No API key, base
// URL or Codex setting in Oriel's own environment reaches it.
export function codexEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return passedEnv(parent, "CODEX_HOME");
}

// What Oriel answers each request Codex makes of it, other than a `run`
// call: every command, file change, permission, elicitation and question
// Codex asks to make or ask is declined. This is the one place that decides
// it. Writes to a connected folder will come through `run` as change sets,
// never through Codex's own tools.
export function codexAnswer(method: string): { result: unknown } | { error: string } {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "execCommandApproval":
    case "applyPatchApproval":
      return {
        result: {
          decision: { denied: { rejection: "Oriel declines every change Codex asks for." } },
        },
      };
    case "mcpServer/elicitation/request":
      return { result: { action: "decline", content: null, _meta: null } };
    default:
      return { error: "Oriel doesn't answer this request." };
  }
}

// The items a locked-down thread may have: what the person said, what the
// model said and thought, `run` calls, and a file change, which waits on
// Oriel's approval and is declined. Anything else is a tool Oriel thought
// was off, and stops the turn.
const allowedItems = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "dynamicToolCall",
  "fileChange",
  "contextCompaction",
]);

// "codex-cli 0.166.0" → [0, 166, 0], or null.
export function codexVersion(output: string): [number, number, number] | null {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)\b/.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// A major version past the ones checked, which Oriel's next update may
// support; an older one, the person's own update fixes.
export const codexTooNew = (version: [number, number, number]): boolean =>
  version[0] > codexMaxMajor;

export function supportedCodex(version: [number, number, number]): boolean {
  const min = codexVersion(codexMinVersion) ?? [0, 0, 0];
  if (codexTooNew(version)) return false;
  for (let i = 0; i < 3; i++) {
    const [have, need] = [version[i] ?? 0, min[i] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

export function locateCodex(
  env: Readonly<Record<string, string | undefined>>,
  path?: string,
): string | null {
  return locateCli("codex", env, path);
}

type Message = Record<string, unknown>;

const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : "");

const number = (value: unknown) => (typeof value === "number" ? value : 0);

// One running app server: requests to it, answered by ID; its notifications
// and its requests of Oriel, queued in order for whoever reads the turn.
// Closing it kills the process and removes its directory.
type Server = {
  cwd: string;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: unknown, answer: { result: unknown } | { error: string }): void;
  // The next notification or request of Oriel's; rejects once the process
  // has ended or been stopped, with why.
  take(): Promise<Message>;
  // Stops it with a reason the turn reports.
  stop(why: string): void;
  close(): void;
};

type ServerOptions = {
  cli: Codex;
  spawn: Spawn;
  parent: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  log: Log;
  overrides?: readonly string[];
  // With no output from Codex for this long, it's stopped. Default 5 min.
  idleMs?: number;
};

function startServer(options: ServerOptions): Server {
  const { signal, log } = options;
  const cwd = mkdtempSync(join(tmpdir(), "oriel-codex-"));
  const child: ChildProcessWithoutNullStreams = options.spawn(
    options.cli.path,
    codexArgs(options.overrides),
    { cwd, env: codexEnv(options.parent) },
  );
  const queue: Message[] = [];
  let wake: (() => void) | null = null;
  let ended: unknown = null;
  let closed = false;
  let requested = 0;
  const waiting = new Map<number, PromiseWithResolvers<unknown>>();
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const end = (why: unknown) => {
    ended ??= why;
    notify();
    for (const w of waiting.values()) w.reject(ended);
    waiting.clear();
  };
  const write = (message: Message) => {
    if (closed || ended) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  let idle: ReturnType<typeof setTimeout> | null = null;
  const idleMs = options.idleMs ?? 5 * 60 * 1000;
  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => stop("it sent nothing for too long"), idleMs);
    idle.unref?.();
  };

  createInterface({ input: child.stdout }).on("line", (line) => {
    touch();
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not a protocol line.
    }
    if (!isObject(message) || ended) return;
    if (message.method === undefined && (message.id !== undefined || "error" in message)) {
      const w = typeof message.id === "number" ? waiting.get(message.id) : undefined;
      if (!w) return;
      waiting.delete(message.id as number);
      if (isObject(message.error))
        w.reject(new ProviderError(`Codex refused: ${text(message.error.message).slice(0, 200)}`));
      else w.resolve(message.result);
      return;
    }
    queue.push(message);
    notify();
  });
  // Codex's diagnostics: counted, never logged, since they may quote input.
  let stderrBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => (stderrBytes += chunk.length));
  child.stdin.on("error", () => {});
  child.on("error", () => end(new ProviderError("Oriel couldn't start Codex.")));
  child.on("close", (code) => {
    if (idle) clearTimeout(idle);
    log("harness.exit", { code, stderr_bytes: stderrBytes, harness: "codex" });
    end(
      signal.aborted
        ? signal.reason
        : new ProviderError(
            `Codex stopped${code === null ? "" : ` (exit code ${code})`} before it answered.`,
          ),
    );
    rmSync(cwd, { recursive: true, force: true });
  });

  const close = () => {
    if (closed) return;
    closed = true;
    if (idle) clearTimeout(idle);
    signal.removeEventListener("abort", onAbort);
    child.stdin.end();
    child.kill("SIGTERM");
  };
  const stop = (why: string) => {
    log("harness.stopped", { reason: why, harness: "codex" });
    queue.length = 0;
    end(new ProviderError(`Oriel stopped Codex: ${why}.`));
    close();
  };
  const onAbort = () => {
    end(signal.reason);
    close();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  touch();

  return {
    cwd,
    request(method, params) {
      if (ended) return Promise.reject(ended);
      const id = ++requested;
      const w = Promise.withResolvers<unknown>();
      waiting.set(id, w);
      write({ id, method, params });
      return w.promise;
    },
    notify(method, params) {
      write(params === undefined ? { method } : { method, params });
    },
    respond(id, answer) {
      write(
        "result" in answer
          ? { id, result: answer.result }
          : { id, error: { code: -32601, message: answer.error } },
      );
    },
    async take() {
      for (;;) {
        if (ended) throw ended;
        const next = queue.shift();
        if (next) return next;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
    stop,
    close,
  };
}

// Opens the app server's session, as a client that takes experimental
// fields: `run` as a client tool is one. Returns where Codex keeps its home.
async function initialize(server: Server): Promise<string> {
  const answer = await server.request("initialize", {
    clientInfo: { name: "oriel", title: "Oriel", version: "1" },
    capabilities: { experimentalApi: true },
  });
  server.notify("initialized");
  return isObject(answer) ? text(answer.codexHome) : "";
}

// The thread's own settings: each MCP server and skill Codex reports, off.
// Codex has no switch for all of them; it reports each by name.
export function threadConfig(effective: unknown, skills: unknown): Message {
  const config = isObject(effective) && isObject(effective.config) ? effective.config : {};
  const servers = isObject(config.mcp_servers) ? Object.keys(config.mcp_servers) : [];
  const entries = isObject(skills) && Array.isArray(skills.data) ? skills.data : [];
  const paths = entries
    .filter(isObject)
    .flatMap((entry) => (Array.isArray(entry.skills) ? entry.skills.filter(isObject) : []))
    .map((skill) => text(skill.path))
    .filter(Boolean);
  return {
    ...Object.fromEntries(servers.map((name) => [`mcp_servers.${name}.enabled`, false])),
    ...(paths.length ? { "skills.config": paths.map((path) => ({ path, enabled: false })) } : {}),
  };
}

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// What Codex reported when the thread started, checked against what Oriel
// asked for: the read-only sandbox with no network, every approval to Oriel,
// its own working directory, and no instructions file but the person's own
// in Codex's home. Null when it passes; else why not.
export function checkStarted(started: unknown, cwd: string, codexHome: string): string | null {
  const report = isObject(started) ? started : {};
  const sandbox = isObject(report.sandbox) ? report.sandbox : {};
  if (sandbox.type !== "readOnly" || sandbox.networkAccess !== false)
    return "its sandbox isn't read-only with no network";
  if (report.approvalPolicy !== "untrusted" || report.approvalsReviewer !== "user")
    return "it doesn't ask Oriel before every command";
  if (real(text(report.cwd)) !== real(cwd)) return "it isn't in Oriel's empty folder";
  const sources = Array.isArray(report.instructionSources) ? report.instructionSources : [];
  const home = codexHome ? real(codexHome) + sep : null;
  if (sources.some((source) => !home || !real(text(source)).startsWith(home)))
    return "it loaded instructions from outside the person's Codex home";
  return null;
}

// Every MCP server the thread knows of is off, and it has no hooks.
export function checkLoaded(servers: unknown, hooks: unknown): string | null {
  const list = isObject(servers) && Array.isArray(servers.data) ? servers.data : null;
  if (!list) return "it didn't say which MCP servers it loaded";
  if (list.some((s) => !isObject(s) || s.runtimeStatus !== "disabled"))
    return "it loaded an MCP server";
  const entries = isObject(hooks) && Array.isArray(hooks.data) ? hooks.data : null;
  if (!entries) return "it didn't say which hooks it loaded";
  if (entries.some((e) => !isObject(e) || !Array.isArray(e.hooks) || e.hooks.length))
    return "it loaded hooks";
  return null;
}

type Thread = { id: string; model: string };

// A locked-down thread: Oriel's prompt in place of Codex's own, `run` or no
// tool, the sandbox and approvals Oriel asks for, and every MCP server and
// skill off. What Codex reports is checked before the model can act.
async function openThread(
  server: Server,
  options: { system: string; tool: ToolSpec | null; model: string },
): Promise<Thread> {
  const codexHome = await initialize(server);
  const effective = await server.request("config/read", { cwd: server.cwd });
  const skills = await server.request("skills/list", { cwds: [server.cwd], forceReload: true });
  const started = await server.request("thread/start", {
    model: options.model,
    cwd: server.cwd,
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "read-only",
    baseInstructions: options.system,
    developerInstructions: "",
    ephemeral: true,
    config: threadConfig(effective, skills),
    dynamicTools: options.tool
      ? [
          {
            type: "function",
            name: options.tool.name,
            description: options.tool.description,
            inputSchema: options.tool.inputSchema,
          },
        ]
      : [],
  });
  const thread = isObject(started) && isObject(started.thread) ? started.thread : {};
  const id = text(thread.id);
  const refused =
    (id ? null : "it started no thread") ?? checkStarted(started, server.cwd, codexHome);
  if (refused) {
    server.stop(refused);
    throw new ProviderError(`Oriel stopped Codex: ${refused}.`);
  }
  const loaded = checkLoaded(
    await server.request("mcpServerStatus/list", { threadId: id, detail: "toolsAndAuthOnly" }),
    await server.request("hooks/list", { threadId: id }),
  );
  if (loaded) {
    server.stop(loaded);
    throw new ProviderError(`Oriel stopped Codex: ${loaded}.`);
  }
  const model = isObject(started) ? text(started.model) || options.model : options.model;
  return { id, model };
}

// An item Codex started that isn't one a locked-down thread may have.
function forbidden(message: Message): string | null {
  if (message.method !== "item/started") return null;
  const params = isObject(message.params) ? message.params : {};
  const item = isObject(params.item) ? params.item : {};
  const type = text(item.type);
  if (!allowedItems.has(type)) return `it started a ${type || "nameless"} item`;
  if (type === "dynamicToolCall" && (item.tool !== runToolName || item.namespace != null))
    return "it called a client tool other than run";
  return null;
}

// Tokens from Codex's own count. Its input counts what was cached.
function usageOf(breakdown: unknown): Usage {
  const b = isObject(breakdown) ? breakdown : {};
  return {
    inputTokens: number(b.inputTokens),
    outputTokens: number(b.outputTokens),
    cacheReadTokens: number(b.cachedInputTokens),
    cacheWriteTokens: number(b.cacheWriteInputTokens),
  };
}

const minus = (a: Usage, b: Usage): Usage => ({
  inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
  outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  cacheReadTokens: Math.max(0, a.cacheReadTokens - b.cacheReadTokens),
  cacheWriteTokens: Math.max(0, a.cacheWriteTokens - b.cacheWriteTokens),
});

const plus = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

const most = (a: Usage, b: Usage): Usage => ({
  inputTokens: Math.max(a.inputTokens, b.inputTokens),
  outputTokens: Math.max(a.outputTokens, b.outputTokens),
  cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
  cacheWriteTokens: Math.max(a.cacheWriteTokens, b.cacheWriteTokens),
});

// A rough count of output so far, from what streamed: a response that runs
// past what the thread's tokens leave is stopped.
const estimate = (chars: number) => Math.ceil(chars / 4);

// Codex's sentence for a failed turn, as the turn reports it.
function turnFailure(turn: Message): ProviderError {
  const error = isObject(turn.error) ? turn.error : {};
  const said = text(error.message).trim().split("\n")[0]?.slice(0, 200);
  return new ProviderError(
    said ? `Codex stopped: ${said}` : "Codex ended the turn without a response.",
  );
}

export type CodexOptions = {
  cli: Codex;
  // One of the models Codex lists.
  model: string;
  // Default "medium". Never Codex's own "ultra", which hands work to
  // sub-agents.
  effort?: Effort;
  // The most output one response may use. Default 64000.
  maxTokens?: number;
  env?: Readonly<Record<string, string | undefined>>;
  spawn?: Spawn;
  idleMs?: number;
  // More `-c` settings, for the live test's stand-in model only.
  overrides?: readonly string[];
  // Told each response's tokens, as it ends, and whether it's a turn's
  // first: counts for Settings, never content.
  counted?: (used: Usage, first: boolean) => void;
};

export function codexProvider(options: CodexOptions): Provider {
  const ceiling = options.maxTokens ?? 64_000;
  const effort = options.effort ?? "medium";
  return {
    converse(request: ConversationRequest): Conversation {
      const { signal, log } = request;
      const tool = request.tools.find((t) => t.name === runToolName) ?? null;
      if (!tool || request.tools.length !== 1)
        throw new ProviderError("The local harness serves exactly one tool, run.");
      const last = request.messages.at(-1);
      if (last?.role !== "user")
        throw new ProviderError("A conversation must end with the user's message.");
      let server: Server | null = null;
      let thread: Thread | null = null;
      let turnId = "";
      // The `run` calls Codex is waiting on: Oriel's answer goes back by the
      // request's own ID.
      const pending = new Map<string, unknown>();
      // Codex's running count for the thread, and how much of it the
      // responses so far have reported. Codex counts a response that called
      // `run` only after Oriel answers the call, so until then that response
      // reports an estimate, at least its last response's input or, first,
      // the request's size: the thread's cap then holds before the run, and
      // the later count adds only what the estimate missed.
      let total: Usage = noUsage;
      let reported: Usage = noUsage;
      let lastInput = 0;
      const opening = estimate(JSON.stringify([request.system, tool, request.messages]).length);
      let responses = 0;
      const count = (used: Usage) => options.counted?.(used, responses++ === 0);

      async function begin(current: Server): Promise<void> {
        thread = await openThread(current, { system: request.system, tool, model: options.model });
        const earlier = request.messages.slice(0, -1);
        // Earlier turns as one stand-in `run` call by Oriel, whose result is
        // the thread so far: source content stays in a tool result.
        if (earlier.length)
          await current.request("thread/inject_items", {
            threadId: thread.id,
            items: [
              {
                type: "function_call",
                name: runToolName,
                call_id: historyCallId,
                arguments: JSON.stringify({ script: historyScript }),
              },
              {
                type: "function_call_output",
                call_id: historyCallId,
                output: historyText(earlier),
              },
            ],
          });
        const started = await current.request("turn/start", {
          threadId: thread.id,
          input: [{ type: "text", text: (last as { text: string }).text, text_elements: [] }],
          effort,
        });
        const turn = isObject(started) && isObject(started.turn) ? started.turn : {};
        turnId = text(turn.id);
        log("harness.ready", {
          harness: "codex",
          version: options.cli.version,
          model: thread.model,
        });
      }

      return {
        async *next(results, { maxOutputTokens }) {
          signal.throwIfAborted();
          const limit = Math.max(1, Math.floor(Math.min(ceiling, maxOutputTokens)));
          if (!server) {
            server = startServer({
              cli: options.cli,
              spawn: options.spawn ?? spawnCli,
              parent: options.env ?? process.env,
              signal,
              log,
              ...(options.overrides ? { overrides: options.overrides } : {}),
              ...(options.idleMs ? { idleMs: options.idleMs } : {}),
            });
            try {
              await begin(server);
            } catch (error) {
              server.close();
              if (signal.aborted) throw signal.reason;
              throw error instanceof ProviderError
                ? error
                : new ProviderError(`Codex didn't start a turn: ${String(error)}`);
            }
          } else
            for (const result of results) {
              const id = pending.get(result.callId);
              if (id === undefined) continue;
              pending.delete(result.callId);
              server.respond(id, {
                result: {
                  contentItems: [{ type: "inputText", text: result.content }],
                  success: !result.isError,
                },
              });
            }
          log("provider.request", { model: options.model, harness: "codex", max_tokens: limit });
          const current = server;
          const model = (thread as Thread | null)?.model ?? options.model;
          let chars = 0;
          const end = (stop: "done" | "calls" | "max-tokens"): ModelEvent => {
            const counted = minus(total, reported);
            const used =
              stop === "calls" && counted.inputTokens === 0
                ? {
                    ...counted,
                    inputTokens: Math.max(lastInput, opening),
                    outputTokens: Math.max(counted.outputTokens, estimate(chars)),
                  }
                : counted;
            const final =
              stop === "max-tokens"
                ? { ...used, outputTokens: Math.max(used.outputTokens, limit) }
                : used;
            reported = most(total, plus(reported, final));
            count(final);
            log("provider.response", { model, stop, harness: "codex" });
            return {
              kind: "end",
              stop,
              detail: stop === "max-tokens" ? "max_tokens" : null,
              model,
              usage: final,
            };
          };
          try {
            for (;;) {
              const message = await current.take();
              const method = text(message.method);
              const params = isObject(message.params) ? message.params : {};
              const why = forbidden(message);
              if (why) {
                current.stop(why);
                continue;
              }
              if (message.id !== undefined) {
                // A request of Oriel's: a `run` call ends this response;
                // anything else gets the one answer Oriel gives.
                if (
                  method === "item/tool/call" &&
                  params.tool === runToolName &&
                  params.namespace == null
                ) {
                  const callId = text(params.callId);
                  if (!callId || pending.has(callId)) {
                    current.respond(message.id, { error: "Oriel has no such call to answer." });
                    continue;
                  }
                  pending.set(callId, message.id);
                  yield {
                    kind: "call",
                    call: { id: callId, name: runToolName, input: params.arguments },
                  };
                  yield end("calls");
                  return;
                }
                log("harness.declined", { method, harness: "codex" });
                current.respond(message.id, codexAnswer(method));
                continue;
              }
              if (method === "item/agentMessage/delta") {
                const delta = text(params.delta);
                chars += delta.length;
                if (delta) yield { kind: "text", text: delta };
              } else if (
                method === "item/reasoning/textDelta" ||
                method === "item/reasoning/summaryTextDelta"
              )
                chars += text(params.delta).length;
              else if (method === "thread/tokenUsage/updated") {
                const usage = isObject(params.tokenUsage) ? params.tokenUsage : {};
                total = usageOf(usage.total);
                lastInput = usageOf(usage.last).inputTokens;
                yield { kind: "usage", usage: minus(total, reported) };
                if (minus(total, reported).outputTokens > limit) chars = Number.POSITIVE_INFINITY;
              } else if (method === "turn/completed") {
                const turn = isObject(params.turn) ? params.turn : {};
                current.close();
                if (turn.status === "completed") {
                  yield end("done");
                  return;
                }
                if (signal.aborted) throw signal.reason;
                throw turnFailure(turn);
              }
              if (estimate(chars) > limit) {
                // Past the thread's room: the turn ends on its budget.
                void current
                  .request("turn/interrupt", { threadId: thread?.id, turnId })
                  .catch(() => {});
                current.close();
                yield end("max-tokens");
                return;
              }
            }
          } catch (error) {
            current.close();
            if (signal.aborted) throw signal.reason;
            if (error instanceof ProviderError) throw error;
            throw new ProviderError(
              `Codex's response couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        close() {
          server?.close();
        },
      };
    },
  };
}

export type CodexTitlerOptions = {
  cli: Codex;
  model: string;
  env?: Readonly<Record<string, string | undefined>>;
  spawn?: Spawn;
  overrides?: readonly string[];
  counted?: (used: Usage) => void;
};

// Thread titles through the person's Codex, locked down as a turn is: the
// constant title prompt in place of Codex's own, the person's message as the
// only input, no tool, and low effort.
export function codexTitler(options: CodexTitlerOptions): Titler {
  return async (input, { signal, log }) => {
    const server = startServer({
      cli: options.cli,
      spawn: options.spawn ?? spawnCli,
      parent: options.env ?? process.env,
      signal,
      log,
      ...(options.overrides ? { overrides: options.overrides } : {}),
    });
    try {
      const thread = await openThread(server, {
        system: titlePrompt,
        tool: null,
        model: options.model,
      });
      await server.request("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text: input, text_elements: [] }],
        effort: "low",
      });
      let answer = "";
      let used: Usage = noUsage;
      for (;;) {
        const message = await server.take();
        const why = forbidden(message);
        if (why) {
          server.stop(why);
          continue;
        }
        const method = text(message.method);
        const params = isObject(message.params) ? message.params : {};
        if (message.id !== undefined) server.respond(message.id, codexAnswer(method));
        else if (method === "item/completed") {
          const item = isObject(params.item) ? params.item : {};
          if (item.type === "agentMessage") answer = text(item.text);
        } else if (method === "thread/tokenUsage/updated") {
          const usage = isObject(params.tokenUsage) ? params.tokenUsage : {};
          used = usageOf(usage.total);
        } else if (method === "turn/completed") {
          const turn = isObject(params.turn) ? params.turn : {};
          log("title: response", {
            model: thread.model,
            stop: text(turn.status) || null,
            input_tokens: used.inputTokens,
            output_tokens: used.outputTokens,
            harness: "codex",
          });
          options.counted?.(used);
          if (turn.status !== "completed") throw turnFailure(turn);
          return titleFrom(answer);
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      server.close();
    }
  };
}

// "plus" → "ChatGPT Plus".
const planName = (plan: string) =>
  /^[a-z_]{1,20}$/.test(plan) && plan !== "unknown"
    ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1).replace(/_/g, " ")}`
    : null;

// The account Codex's `account/read` names, or null when it's signed out.
// An API key of the person's own counts as signed in, with no plan.
export function accountOf(answer: unknown): CodexAccount | null {
  const account = isObject(answer) && isObject(answer.account) ? answer.account : null;
  if (!account) return null;
  if (account.type !== "chatgpt") return { plan: null, email: null, personal: false };
  const email = text(account.email);
  const plan = text(account.planType);
  return {
    plan: planName(plan),
    email: email || null,
    personal: !commercialPlans.includes(plan),
  };
}

// The models Codex lists, the ones it hides left out.
export function modelsOf(answer: unknown): CodexModel[] {
  const list = isObject(answer) && Array.isArray(answer.data) ? answer.data : [];
  return list
    .filter(isObject)
    .filter((m) => m.hidden !== true && text(m.model) !== "")
    .map((m) => ({
      id: text(m.model),
      label: text(m.displayName) || text(m.model),
      isDefault: m.isDefault === true,
    }));
}

const windowKinds: Record<number, PlanWindow["kind"]> = { 300: "session", 10080: "week" };

// Codex's `account/rateLimits/read`, as numbers only: the five-hour session
// and the week, each as much as is used and when it resets.
export function codexPlanOf(answer: unknown): PlanUsage {
  const limits = isObject(answer) && isObject(answer.rateLimits) ? answer.rateLimits : null;
  if (!limits) return { none: "no-plan" };
  const windows = [limits.primary, limits.secondary].filter(isObject).flatMap((w): PlanWindow[] => {
    const kind = windowKinds[number(w.windowDurationMins)];
    if (!kind || typeof w.usedPercent !== "number") return [];
    const usedPercent = Math.min(100, Math.max(0, Math.round(w.usedPercent)));
    const resetsAt =
      typeof w.resetsAt === "number" ? new Date(w.resetsAt * 1000).toISOString() : null;
    return [{ kind, usedPercent, resetsAt }];
  });
  return {
    windows: windows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "session" ? -1 : 1)),
  };
}

export type CodexCheckOptions = {
  path?: string;
  env?: Readonly<Record<string, string | undefined>>;
  version?: (cli: string) => Promise<string>;
  spawn?: Spawn;
};

const runVersion = (cli: string, env: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    execFile(cli, ["--version"], { env, cwd: tmpdir(), timeout: 20_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

// A short session with the app server, with no thread and no model request.
async function ask<T>(
  cli: Codex,
  options: { env?: Readonly<Record<string, string | undefined>>; spawn?: Spawn },
  asking: (server: Server) => Promise<T>,
): Promise<T> {
  const server = startServer({
    cli,
    spawn: options.spawn ?? spawnCli,
    parent: options.env ?? process.env,
    signal: AbortSignal.timeout(25_000),
    log: () => {},
  });
  try {
    await initialize(server);
    return await asking(server);
  } finally {
    server.close();
  }
}

const installHint = "Install Codex and sign in to it, then restart Oriel.";

// At startup and on each look: Codex is there, its version is one Oriel
// checked, and it is signed in, by its own `account/read`, which makes no
// model request. Also the models it offers and, for the row only, its plan
// and email.
export async function checkCodex(
  options: CodexCheckOptions = {},
): Promise<
  | { ok: true; cli: Codex; models: CodexModel[]; account: CodexAccount }
  | { ok: false; problem: HarnessProblem }
> {
  const parent = options.env ?? process.env;
  const path = locateCodex(parent, options.path);
  if (!path)
    return {
      ok: false,
      problem: {
        kind: "missing",
        message: options.path
          ? `There's no Codex at the configured path. ${installHint}`
          : "Codex isn't installed here.",
      },
    };
  let output: string;
  try {
    output = await (options.version ?? ((cli) => runVersion(cli, codexEnv(parent))))(path);
  } catch {
    return {
      ok: false,
      problem: { kind: "missing", message: `Codex didn't start. ${installHint}` },
    };
  }
  const version = codexVersion(output);
  if (!version || !supportedCodex(version))
    return {
      ok: false,
      problem: {
        kind: "unsupported",
        message:
          version && codexTooNew(version)
            ? `This Codex (${version.join(".")}) is newer than Oriel works with yet. Oriel's next update will work with it.`
            : `Oriel needs Codex ${codexMinVersion} or a later 0.x${version ? `; this one is ${version.join(".")}` : ""}. Update it, then restart Oriel.`,
        ...(version ? { version: version.join(".") } : {}),
      },
    };
  const cli = { path, version: version.join(".") };
  try {
    const { account, models } = await ask(
      cli,
      { env: parent, ...(options.spawn ? { spawn: options.spawn } : {}) },
      async (server) => ({
        account: accountOf(await server.request("account/read", {})),
        models: modelsOf(await server.request("model/list", {})),
      }),
    );
    if (!account)
      return {
        ok: false,
        problem: {
          kind: "signed-out",
          message: "Codex is installed but not signed in. Sign in to it, then restart Oriel.",
        },
      };
    if (!models.length)
      return {
        ok: false,
        problem: {
          kind: "missing",
          message: "Codex lists no models Oriel can use. Restart Oriel to try again.",
        },
      };
    return { ok: true, cli, models, account };
  } catch {
    return {
      ok: false,
      problem: {
        kind: "missing",
        message: "Codex didn't answer when Oriel started it. Restart Oriel to try again.",
      },
    };
  }
}

// How much of the person's ChatGPT plan is used, from Codex's own
// `account/rateLimits/read`, which makes no model request.
export async function codexPlan(
  cli: Codex,
  options: { env?: Readonly<Record<string, string | undefined>>; spawn?: Spawn } = {},
): Promise<PlanUsage> {
  try {
    return codexPlanOf(
      await ask(cli, options, (server) => server.request("account/rateLimits/read", {})),
    );
  } catch {
    return { none: "no-answer" };
  }
}

// Codex's answers to `mcpServerStatus/list`, page by page, and `config/read`,
// as Oriel looks servers up by: each one's name, whether it's usable, the
// name it reports, its URL or command line from the person's configuration,
// and its tools' names. Never its configuration's other fields, such as its
// headers or environment, which may hold a secret.
export function codexServersOf(pages: readonly unknown[], effective: unknown): FoundServer[] {
  const config = isObject(effective) && isObject(effective.config) ? effective.config : {};
  const configured = isObject(config.mcp_servers) ? config.mcp_servers : {};
  return pages
    .flatMap((page) => (isObject(page) && Array.isArray(page.data) ? page.data : []))
    .filter(isObject)
    .flatMap((server): FoundServer[] => {
      const name = text(server.name);
      if (!name) return [];
      const own = isObject(configured[name]) ? configured[name] : {};
      const info = isObject(server.serverInfo) ? server.serverInfo : {};
      const args = Array.isArray(own.args) ? own.args.map(text) : [];
      const tools = isObject(server.tools) ? Object.keys(server.tools) : [];
      const status: FoundServer["status"] =
        server.runtimeStatus === "disabled"
          ? "disabled"
          : server.authStatus === "notLoggedIn"
            ? "needs-auth"
            : server.toolsError != null
              ? "failed"
              : "connected";
      return [
        {
          name,
          status,
          reports: text(info.name) || null,
          url: text(own.url) || null,
          command: text(own.command) ? [text(own.command), ...args].join(" ") : null,
          tools: status === "connected" ? tools : [],
        },
      ];
    });
}

// The person's own MCP servers, as their Codex lists them: its app server's
// `mcpServerStatus/list`, which starts each and lists its tools, with no
// thread and no model request.
export async function codexServers(
  cli: Codex,
  options: { env?: Readonly<Record<string, string | undefined>>; spawn?: Spawn } = {},
): Promise<FoundServer[]> {
  return ask(cli, options, async (server) => {
    const pages: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await server.request("mcpServerStatus/list", {
        detail: "toolsAndAuthOnly",
        ...(cursor ? { cursor } : {}),
      });
      pages.push(page);
      cursor = isObject(page) ? text(page.nextCursor) || null : null;
    } while (cursor && pages.length < 20);
    return codexServersOf(pages, await server.request("config/read", { cwd: server.cwd }));
  });
}
