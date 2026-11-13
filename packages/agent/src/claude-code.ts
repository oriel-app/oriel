// Synced content reaches this process, so it is locked down, and the CLI's own report of its
// tools, servers and permission mode is checked before it can act.
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { FoundServer, Log } from "@oriel/core";
import { defaultModel, type Effort, readResponse, type Reply } from "./anthropic.ts";
import type { DevServer } from "./codex.ts";
import { runToolName } from "./prompt.ts";
import {
  type Conversation,
  type ConversationRequest,
  type ModelEvent,
  type ModelMessage,
  type Provider,
  ProviderError,
  type ToolResult,
  type ToolSpec,
  type Usage,
} from "./provider.ts";
import { type Titler, titleFrom, titleModel, titlePrompt } from "./title.ts";

export const claudeCodeMinVersion = "2.1.314";
const claudeCodeMaxMajor = 2;

export const harnessServer = "oriel";
export const harnessRunTool = `mcp__${harnessServer}__${runToolName}`;

// Over its own default, the CLI would save a result to a file in the person's home and show the
// model a path it can't open.
const maxResultChars = 1_000_000;

export type ClaudeCode = { path: string; version: string };

export type Spawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
) => ChildProcessWithoutNullStreams;

export const spawnCli: Spawn = (command, args, options) =>
  spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });

// Nothing else, so no API key, base URL or CLI setting in Oriel's own environment reaches the CLI.
const passed = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

export function passedEnv(
  parent: Readonly<Record<string, string | undefined>>,
  configDir: "CLAUDE_CONFIG_DIR" | "CODEX_HOME" = "CLAUDE_CONFIG_DIR",
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...passed, configDir]) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export function harnessEnv(
  parent: Readonly<Record<string, string | undefined>>,
  maxOutputTokens: number,
): Record<string, string> {
  return {
    ...passedEnv(parent),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    // An `@path` in the user's text would otherwise attach that file.
    CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
    CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
    DISABLE_AUTOUPDATER: "1",
    // No feedback command, survey (which can send a transcript), telemetry or error reports; not
    // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, which turns off more.
    DISABLE_FEEDBACK_COMMAND: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    // `run`'s description holds the region's module whole, and a run may take
    // its wall time and more before Oriel answers the call.
    CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH: String(maxResultChars),
    MCP_TOOL_TIMEOUT: String(10 * 60 * 1000),
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(Math.max(1, Math.floor(maxOutputTokens))),
  };
}

export type HarnessArgs = {
  system: string;
  model: string;
  effort: Effort;
  run: boolean;
};

export function harnessArgs(options: HarnessArgs): string[] {
  const servers = options.run ? { [harnessServer]: { type: "sdk", name: harnessServer } } : {};
  return [
    "-p",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--system-prompt",
    options.system,
    "--model",
    options.model,
    "--effort",
    options.effort,
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: servers }),
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--safe-mode",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    ...(options.run ? ["--allowed-tools", harnessRunTool] : []),
    "--permission-prompt-tool",
    "stdio",
  ];
}

export type HarnessProblem = {
  kind: "missing" | "unsupported" | "signed-out";
  message: string;
  version?: string;
};

const installHint = "Install Claude Code and sign in to it, then restart Oriel.";

export function parseVersion(output: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)\b/.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export const tooNew = (version: [number, number, number]): boolean =>
  version[0] > claudeCodeMaxMajor;

export function supportedVersion(version: [number, number, number]): boolean {
  const min = parseVersion(claudeCodeMinVersion) ?? [0, 0, 0];
  if (tooNew(version)) return false;
  for (let i = 0; i < 3; i++) {
    const [have, need] = [version[i] ?? 0, min[i] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

export function locateClaudeCode(
  env: Readonly<Record<string, string | undefined>>,
  path?: string,
): string | null {
  return locateCli("claude", env, path);
}

export function locateCli(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  path?: string,
): string | null {
  const executable = (file: string) => {
    try {
      accessSync(file, constants.X_OK);
      return statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (path) return executable(path) ? path : null;
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const name of names) if (executable(join(dir, name))) return join(dir, name);
  return null;
}

export type CheckOptions = {
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

export async function checkClaudeCode(
  options: CheckOptions = {},
): Promise<{ ok: true; cli: ClaudeCode } | { ok: false; problem: HarnessProblem }> {
  const parent = options.env ?? process.env;
  const path = locateClaudeCode(parent, options.path);
  if (!path)
    return {
      ok: false,
      problem: {
        kind: "missing",
        message: options.path
          ? `There's no Claude Code at the configured path. ${installHint}`
          : `Oriel's agent runs on Claude Code, which isn't installed here. ${installHint}`,
      },
    };
  const env = harnessEnv(parent, 1);
  let output: string;
  try {
    output = await (options.version ?? ((cli) => runVersion(cli, env)))(path);
  } catch {
    return {
      ok: false,
      problem: { kind: "missing", message: `Claude Code didn't start. ${installHint}` },
    };
  }
  const version = parseVersion(output);
  if (!version || !supportedVersion(version))
    return {
      ok: false,
      problem: {
        kind: "unsupported",
        message: `Oriel needs Claude Code ${claudeCodeMinVersion} or a later 2.x${version ? `; this one is ${version.join(".")}` : ""}. Update it, then restart Oriel.`,
        ...(version ? { version: version.join(".") } : {}),
      },
    };
  const cli = { path, version: version.join(".") };
  const account = await probeAccount(cli, parent, options.spawn ?? spawnCli);
  if (account !== "signed-in")
    return {
      ok: false,
      problem:
        account === "signed-out"
          ? {
              kind: "signed-out",
              message:
                "Claude Code is installed but not signed in. Open it in a terminal and sign in, then restart Oriel.",
            }
          : {
              kind: "missing",
              message:
                "Claude Code didn't answer when Oriel started it. Restart Oriel to try again.",
            },
    };
  return { ok: true, cli };
}

export type Message = Record<string, unknown>;

const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function signedIn(initialize: unknown): boolean {
  const account = isObject(initialize) && isObject(initialize.account) ? initialize.account : {};
  const set = (key: string) => text(account[key]) !== "" && account[key] !== "none";
  if (set("apiProvider") && account.apiProvider !== "firstParty") return true;
  return set("subscriptionType") || set("email") || set("tokenSource") || set("apiKeySource");
}

async function probeAccount(
  cli: ClaudeCode,
  parent: Readonly<Record<string, string | undefined>>,
  spawner: Spawn,
): Promise<"signed-in" | "signed-out" | "no-answer"> {
  const session = startSession({
    cli,
    spawn: spawner,
    parent,
    args: harnessArgs({
      system: "Oriel checks the sign-in.",
      model: titleModel,
      effort: "low",
      run: false,
    }),
    maxOutputTokens: 1,
    tool: null,
    signal: AbortSignal.timeout(25_000),
    log: () => {},
  });
  try {
    return signedIn(await session.initialized) ? "signed-in" : "signed-out";
  } catch {
    return "no-answer";
  } finally {
    session.close();
  }
}

export type PlanWindow = { kind: "session" | "week"; usedPercent: number; resetsAt: string | null };

export type PlanUsage = { windows: PlanWindow[] } | { none: "no-plan" | "no-answer" };

const windowKinds = { five_hour: "session", seven_day: "week" } as const;

export function parsePlan(response: unknown): PlanUsage {
  if (!isObject(response) || response.rate_limits_available !== true) return { none: "no-plan" };
  const limits = isObject(response.rate_limits) ? response.rate_limits : {};
  const windows = Object.entries(windowKinds).flatMap(([key, kind]): PlanWindow[] => {
    const window = limits[key];
    if (!isObject(window) || typeof window.utilization !== "number") return [];
    const usedPercent = Math.min(100, Math.max(0, Math.round(window.utilization)));
    const at = typeof window.resets_at === "string" ? Date.parse(window.resets_at) : NaN;
    return [{ kind, usedPercent, resetsAt: Number.isNaN(at) ? null : new Date(at).toISOString() }];
  });
  return { windows };
}

export async function claudeCodePlan(
  cli: ClaudeCode,
  options: { env?: Readonly<Record<string, string | undefined>>; spawn?: Spawn } = {},
): Promise<PlanUsage> {
  const session = startSession({
    cli,
    spawn: options.spawn ?? spawnCli,
    parent: options.env ?? process.env,
    args: harnessArgs({
      system: "Oriel checks the plan's usage.",
      model: titleModel,
      effort: "low",
      run: false,
    }),
    maxOutputTokens: 1,
    tool: null,
    signal: AbortSignal.timeout(25_000),
    log: () => {},
  });
  try {
    await session.initialized;
    return parsePlan(await session.request({ subtype: "get_usage", skip_behaviors: true }));
  } catch {
    return { none: "no-answer" };
  } finally {
    session.close();
  }
}

// No message is ever sent, so the model never runs. Not `--safe-mode`, which loads no server.
export function discoveryArgs(dev: readonly DevServer[] = []): string[] {
  return [
    ...(dev.length ? ["--mcp-config", JSON.stringify(devConfig(dev))] : []),
    "-p",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--system-prompt",
    "Oriel lists the person's MCP servers.",
    "--model",
    titleModel,
    "--effort",
    "low",
    "--tools",
    "",
    "--setting-sources",
    "user",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--permission-prompt-tool",
    "stdio",
  ];
}

const serverStatuses = ["connected", "needs-auth", "failed", "pending", "disabled"] as const;

// Never a server's other configuration fields, such as its headers or environment, which may
// hold a secret.
export function claudeCodeServersOf(answer: unknown): FoundServer[] {
  const listed = isObject(answer) && Array.isArray(answer.mcpServers) ? answer.mcpServers : [];
  return listed.filter(isObject).flatMap((server): FoundServer[] => {
    const name = text(server.name);
    if (!name || server.source === "sdk") return [];
    const status = serverStatuses.find((each) => each === server.status) ?? "failed";
    const info = isObject(server.serverInfo) ? server.serverInfo : {};
    const config = isObject(server.config) ? server.config : {};
    const args = Array.isArray(config.args) ? config.args.map(text) : [];
    const prefix = `mcp__${name}__`;
    const tools = (Array.isArray(server.tools) ? server.tools : [])
      .map((tool) => (isObject(tool) ? text(tool.name) : ""))
      .filter(Boolean)
      .map((tool) => (tool.startsWith(prefix) ? tool.slice(prefix.length) : tool));
    return [
      {
        name,
        status,
        reports: text(info.name) || null,
        url: text(config.url) || null,
        command: text(config.command) ? [text(config.command), ...args].join(" ") : null,
        tools,
        ...(remote.includes(text(config.type)) ? { transport: text(config.type) as "http" } : {}),
        ...(text(config.command) ? { local: { command: text(config.command), args } } : {}),
      },
    ];
  });
}

export const devConfig = (dev: readonly DevServer[]) => ({
  mcpServers: Object.fromEntries(
    dev.map(({ name, command, args }) => [name, { type: "stdio", command, args }]),
  ),
});

const remote = ["http", "sse"];

export async function claudeCodeServers(
  cli: ClaudeCode,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    spawn?: Spawn;
    waitMs?: number;
    pollMs?: number;
    dev?: readonly DevServer[];
  } = {},
): Promise<FoundServer[]> {
  const waitMs = options.waitMs ?? 15_000;
  const session = startSession({
    cli,
    spawn: options.spawn ?? spawnCli,
    parent: options.env ?? process.env,
    args: discoveryArgs(options.dev),
    maxOutputTokens: 1,
    tool: null,
    signal: AbortSignal.timeout(waitMs + 25_000),
    log: () => {},
  });
  try {
    await session.initialized;
    const until = Date.now() + waitMs;
    for (;;) {
      const found = claudeCodeServersOf(await session.request({ subtype: "mcp_status" }));
      if (!found.some((each) => each.status === "pending") || Date.now() >= until) return found;
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 500));
    }
  } finally {
    session.close();
  }
}

export type Session = {
  send(message: Message): void;
  initialized: Promise<unknown>;
  request(request: Message): Promise<unknown>;
  take(): Promise<Message>;
  answer(results: readonly ToolResult[]): void;
  // The calls this response made, as the model streamed them, so a call the
  // CLI asks to run is answered only for the input the loop ran.
  expect(calls: readonly { id: string; input: unknown }[]): void;
  close(): void;
};

export type SessionOptions = {
  cli: ClaudeCode;
  spawn: Spawn;
  parent: Readonly<Record<string, string | undefined>>;
  args: string[];
  maxOutputTokens: number;
  tool: ToolSpec | null;
  signal: AbortSignal;
  log: Log;
  idleMs?: number;
};

const mcpResult = (content: string, isError: boolean) => ({
  content: [{ type: "text", text: content }],
  isError,
});

const sameInput = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function startSession(options: SessionOptions): Session {
  const { cli, tool, signal, log } = options;
  const cwd = mkdtempSync(join(tmpdir(), "oriel-claude-"));
  const child = options.spawn(cli.path, options.args, {
    cwd,
    env: harnessEnv(options.parent, options.maxOutputTokens),
  });
  const queue: Message[] = [];
  let wake: (() => void) | null = null;
  let ended: unknown = null;
  let closed = false;
  let ready = false;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const end = (why: unknown) => {
    ended ??= why;
    notify();
    settleInit.reject(ended);
    for (const waiting of requests.values()) waiting.reject(ended);
    requests.clear();
  };
  const settleInit = Promise.withResolvers<unknown>();
  const requests = new Map<string, PromiseWithResolvers<unknown>>();
  let requested = 0;
  // Never unhandled: a session nobody initializes still ends.
  settleInit.promise.catch(() => {});

  // A `run` call is answered once the CLI asks (often mid-stream), the response ends with the call
  // as the model wrote it, and the loop has its result, in any order.
  const results = new Map<string, ToolResult>();
  const asked = new Map<string, { input: unknown; answer: (result: ToolResult) => void }>();
  const inputs = new Map<string, unknown>();
  const settle = (callId: string) => {
    const call = asked.get(callId);
    if (!call || !inputs.has(callId)) return;
    const ready = sameInput(inputs.get(callId), call.input)
      ? results.get(callId)
      : { callId, content: "This call's input isn't what Oriel ran.", isError: true };
    if (!ready) return;
    asked.delete(callId);
    call.answer(ready);
  };

  const send = (message: Message) => {
    if (closed || ended) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const respond = (requestId: unknown, response: Message) =>
    send({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    });
  const refuse = (requestId: unknown, error: string) =>
    send({
      type: "control_response",
      response: { subtype: "error", request_id: requestId, error },
    });

  const stop = (why: string) => {
    log("harness.stopped", { reason: why });
    queue.length = 0;
    end(new ProviderError(`Oriel stopped Claude Code: ${why}.`));
    close();
  };

  const checkInit = (init: Message) => {
    const tools = Array.isArray(init.tools) ? init.tools : null;
    const servers = Array.isArray(init.mcp_servers) ? init.mcp_servers.filter(isObject) : null;
    const plugins = Array.isArray(init.plugins) ? init.plugins.filter(isObject) : [];
    const want = tool ? [harnessRunTool] : [];
    if (!tools || !sameInput(tools, want)) return stop("it loaded tools other than run");
    const names = (servers ?? []).map((s) => `${text(s.name)}:${text(s.status)}`);
    if (!servers || !sameInput(names, tool ? [`${harnessServer}:connected`] : []))
      return stop("it loaded MCP servers other than Oriel's");
    if (init.permissionMode !== "dontAsk") return stop("its permission mode isn't dontAsk");
    if (plugins.some((p) => p.path !== "builtin")) return stop("it loaded the person's plugins");
    for (const key of ["skills", "slash_commands"] as const)
      if (Array.isArray(init[key]) && init[key].length) return stop(`it loaded ${key}`);
    ready = true;
    log("harness.ready", { version: text(init.claude_code_version), model: text(init.model) });
  };

  const mcp = (requestId: unknown, message: Message) => {
    const id = message.id ?? 0;
    const reply = (body: Message) =>
      respond(requestId, { mcp_response: { jsonrpc: "2.0", id, ...body } });
    const method = text(message.method);
    if (!tool) return reply({ error: { code: -32601, message: "No tools here." } });
    if (method === "initialize") {
      const params = isObject(message.params) ? message.params : {};
      return reply({
        result: {
          protocolVersion: text(params.protocolVersion) || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: harnessServer, version: "1" },
        },
      });
    }
    if (method.startsWith("notifications/") || method === "ping") return reply({ result: {} });
    if (method === "tools/list")
      return reply({
        result: {
          tools: [
            {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              _meta: { "anthropic/maxResultSizeChars": maxResultChars },
            },
          ],
        },
      });
    if (method !== "tools/call")
      return reply({ error: { code: -32601, message: `Oriel doesn't serve ${method}.` } });
    if (!ready) return stop("it asked to run a call before reporting what it loaded");
    const params = isObject(message.params) ? message.params : {};
    const meta = isObject(params._meta) ? params._meta : {};
    const callId = text(meta["claudecode/toolUseId"]);
    const answer = (result: ToolResult) =>
      reply({ result: mcpResult(result.content, result.isError) });
    if (params.name !== runToolName || !callId || asked.has(callId))
      return answer({ callId, content: "Oriel has no such call to answer.", isError: true });
    asked.set(callId, { input: params.arguments, answer });
    settle(callId);
  };

  const control = (message: Message) => {
    const request = isObject(message.request) ? message.request : {};
    const id = message.request_id;
    if (request.subtype === "mcp_message") {
      if (request.server_name !== harnessServer || !isObject(request.message))
        return refuse(id, "Unknown server.");
      return mcp(id, request.message);
    }
    if (request.subtype === "can_use_tool")
      return respond(
        id,
        request.tool_name === harnessRunTool
          ? { behavior: "allow", updatedInput: request.input }
          : { behavior: "deny", message: "Only Oriel's run tool is available." },
      );
    refuse(id, "Oriel doesn't answer this request.");
  };

  let idle: ReturnType<typeof setTimeout> | null = null;
  const idleMs = options.idleMs ?? 5 * 60 * 1000;
  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => stop("it sent nothing for too long"), idleMs);
    idle.unref?.();
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    touch();
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message) || ended) return;
    if (message.type === "control_request") return control(message);
    if (message.type === "control_response") {
      const response = isObject(message.response) ? message.response : {};
      if (response.request_id === "init") {
        if (response.subtype === "success") settleInit.resolve(response.response);
        else end(new ProviderError("Claude Code refused to start a session."));
      }
      const waiting = requests.get(text(response.request_id));
      if (waiting) {
        requests.delete(text(response.request_id));
        if (response.subtype === "success") waiting.resolve(response.response);
        else waiting.reject(new ProviderError("Claude Code refused Oriel's request."));
      }
      return;
    }
    if (message.type === "system" && message.subtype === "init") checkInit(message);
    else if (!ready && message.type !== "system")
      return stop("it answered before reporting what it loaded");
    if (ended) return;
    queue.push(message);
    notify();
  });
  // The CLI's diagnostics: counted, never logged, since they may quote input.
  let stderrBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => (stderrBytes += chunk.length));
  child.stdin.on("error", () => {});
  child.on("error", () => end(new ProviderError("Oriel couldn't start Claude Code.")));
  child.on("close", (code) => {
    if (idle) clearTimeout(idle);
    log("harness.exit", { code, stderr_bytes: stderrBytes });
    end(
      signal.aborted
        ? signal.reason
        : new ProviderError(
            `Claude Code stopped${code === null ? "" : ` (exit code ${code})`} before it answered.`,
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
  const onAbort = () => {
    end(signal.reason);
    close();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  touch();
  send({
    type: "control_request",
    request_id: "init",
    request: { subtype: "initialize", ...(tool ? { sdkMcpServers: [harnessServer] } : {}) },
  });

  return {
    send,
    initialized: settleInit.promise,
    request(request) {
      if (ended) return Promise.reject(ended);
      const id = `oriel-${++requested}`;
      const waiting = Promise.withResolvers<unknown>();
      requests.set(id, waiting);
      send({ type: "control_request", request_id: id, request });
      return waiting.promise;
    },
    async take() {
      for (;;) {
        if (ended) throw ended;
        const next = queue.shift();
        if (next) return next;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
    answer(list) {
      for (const result of list) {
        results.set(result.callId, result);
        settle(result.callId);
      }
    },
    expect(calls) {
      for (const call of calls) inputs.set(call.id, call.input);
      for (const [callId, call] of asked)
        if (!inputs.has(callId)) {
          asked.delete(callId);
          call.answer({ callId, content: "Oriel has no such call to answer.", isError: true });
        }
      for (const callId of asked.keys()) settle(callId);
    },
    close,
  };
}

// Made by Oriel, not the model: a fresh CLI keeps tool results only when they share one user
// message with the text that follows them.
export const historyCallId = "oriel_thread_so_far";
export const historyScript =
  "// Oriel's record of this thread so far. Not a run: nothing was read.";

// Earlier messages as one tool result: one JSON object a line, so nothing a
// source wrote can pass for a line of its own.
export function historyText(messages: readonly ModelMessage[]): string {
  const lines = messages.flatMap((message): object[] => {
    if (message.role === "user") return [{ user: message.text }];
    if (message.role === "tool")
      return message.results.map((r) =>
        r.isError ? { result: r.content, failed: true } : { result: r.content },
      );
    const said = message.text.trim() ? [{ you: message.text }] : [];
    return [
      ...said,
      ...message.calls.map((call) => {
        const input = isObject(call.input) ? call.input : {};
        return {
          you_ran: typeof input.script === "string" ? input.script : JSON.stringify(call.input),
        };
      }),
    ];
  });
  return [
    "The thread so far, oldest first, one JSON object a line: what the user said, what you said, each script you ran and its result. The user's new message follows.",
    ...lines.map((line) => JSON.stringify(line)),
  ].join("\n");
}

export function openingMessages(messages: readonly ModelMessage[]): Message[] {
  const last = messages.at(-1);
  if (last?.role !== "user")
    throw new ProviderError("A conversation must end with the user's message.");
  const earlier = messages.slice(0, -1);
  const user = (content: unknown): Message => ({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  });
  if (!earlier.length) return [user([{ type: "text", text: last.text }])];
  return [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: historyCallId,
            name: harnessRunTool,
            input: { script: historyScript },
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: "",
    },
    user([
      { type: "tool_result", tool_use_id: historyCallId, content: historyText(earlier) },
      { type: "text", text: last.text },
    ]),
  ];
}

function resultError(message: Message): ProviderError {
  const said = text(message.result).trim().split("\n")[0]?.slice(0, 200);
  return new ProviderError(
    message.is_error && said
      ? `Claude Code stopped: ${said}`
      : "Claude Code ended the turn without a response.",
  );
}

export type ClaudeCodeOptions = {
  cli: ClaudeCode;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  env?: Readonly<Record<string, string | undefined>>;
  spawn?: Spawn;
  idleMs?: number;
  counted?: (used: Usage, first: boolean) => void;
};

const estimate = (chars: number, thinking: number) => Math.ceil(chars / 4) + thinking;

export function claudeCodeProvider(options: ClaudeCodeOptions): Provider {
  const model = options.model ?? defaultModel;
  const ceiling = options.maxTokens ?? 64_000;
  const effort = options.effort ?? "medium";
  return {
    converse(request: ConversationRequest): Conversation {
      const { signal, log } = request;
      const tool = request.tools.find((t) => t.name === runToolName) ?? null;
      if (!tool || request.tools.length !== 1)
        throw new ProviderError("The local harness serves exactly one tool, run.");
      let session: Session | null = null;
      let responses = 0;
      const count = (used: Usage) => options.counted?.(used, responses++ === 0);
      return {
        async *next(results, { maxOutputTokens }) {
          signal.throwIfAborted();
          const limit = Math.max(1, Math.floor(Math.min(ceiling, maxOutputTokens)));
          if (!session) {
            const opening = openingMessages(request.messages);
            session = startSession({
              cli: options.cli,
              spawn: options.spawn ?? spawnCli,
              parent: options.env ?? process.env,
              args: harnessArgs({ system: request.system, model, effort, run: true }),
              maxOutputTokens: limit,
              tool,
              signal,
              log,
              ...(options.idleMs ? { idleMs: options.idleMs } : {}),
            });
            for (const message of opening) session.send(message);
          } else session.answer(results);
          log("provider.request", { model, harness: "claude-code", max_tokens: limit });

          const current = session;
          let usage: Usage | null = null;
          let chars = 0;
          let thinking = 0;
          let over = false;
          async function* events(): AsyncGenerator<unknown> {
            for (;;) {
              const message = await current.take();
              if (message.type === "result") throw resultError(message);
              if (message.type === "system" && message.subtype === "thinking_tokens") {
                if (typeof message.estimated_tokens === "number")
                  thinking = message.estimated_tokens;
              } else if (message.type === "stream_event" && message.parent_tool_use_id == null) {
                const event = isObject(message.event) ? message.event : {};
                const delta = isObject(event.delta) ? event.delta : {};
                chars += text(delta.text).length + text(delta.partial_json).length;
                yield event;
                if (event.type === "message_stop") return;
              } else continue;
              if (estimate(chars, thinking) > limit) {
                over = true;
                return;
              }
            }
          }

          const reader = readResponse(events(), model);
          let reply: Reply | null = null;
          try {
            for (;;) {
              const step = await reader.next();
              if (step.done) {
                reply = step.value;
                break;
              }
              if (step.value.kind === "usage") usage = step.value.usage;
              yield step.value;
            }
          } catch (error) {
            current.close();
            if (signal.aborted) throw signal.reason;
            if (over) {
              const used = usage ?? {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              };
              log("provider.response", { model, stop: "max-tokens", harness: "claude-code" });
              const reached = { ...used, outputTokens: Math.max(used.outputTokens, limit) };
              count(reached);
              yield {
                kind: "end",
                stop: "max-tokens",
                detail: "max_tokens",
                model,
                usage: reached,
              } satisfies ModelEvent;
              return;
            }
            if (error instanceof ProviderError) throw error;
            throw new ProviderError(
              `Claude Code's response couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          const calls = reply.calls.map((call) => ({
            ...call,
            name: call.name === harnessRunTool ? runToolName : call.name,
          }));
          current.expect(calls);
          log("provider.response", {
            model: reply.model,
            stop: reply.stop,
            harness: "claude-code",
          });
          for (const call of calls) yield { kind: "call", call };
          const { stop, detail, usage: final } = reply;
          count(final);
          yield { kind: "end", stop, detail, model: reply.model, usage: final };
          if (stop !== "calls") current.close();
        },
        close() {
          session?.close();
        },
      };
    },
  };
}

export type ClaudeCodeTitlerOptions = {
  cli: ClaudeCode;
  model?: string;
  env?: Readonly<Record<string, string | undefined>>;
  spawn?: Spawn;
  counted?: (used: Usage) => void;
};

export function claudeCodeTitler(options: ClaudeCodeTitlerOptions): Titler {
  const model = options.model ?? titleModel;
  return async (input, { signal, log }) => {
    const session = startSession({
      cli: options.cli,
      spawn: options.spawn ?? spawnCli,
      parent: options.env ?? process.env,
      args: harnessArgs({ system: titlePrompt, model, effort: "low", run: false }),
      maxOutputTokens: 1024,
      tool: null,
      signal,
      log,
    });
    try {
      session.send({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: input }] },
        parent_tool_use_id: null,
        session_id: "",
      });
      for (;;) {
        const message = await session.take();
        if (message.type !== "result") continue;
        const usage = isObject(message.usage) ? message.usage : {};
        const count = (key: string) => (typeof usage[key] === "number" ? usage[key] : 0);
        log("title: response", {
          model,
          stop: text(message.stop_reason) || null,
          input_tokens:
            count("input_tokens") +
            count("cache_read_input_tokens") +
            count("cache_creation_input_tokens"),
          output_tokens: count("output_tokens"),
          harness: "claude-code",
        });
        const cacheReadTokens = count("cache_read_input_tokens");
        const cacheWriteTokens = count("cache_creation_input_tokens");
        options.counted?.({
          inputTokens: count("input_tokens") + cacheReadTokens + cacheWriteTokens,
          outputTokens: count("output_tokens"),
          cacheReadTokens,
          cacheWriteTokens,
        });
        if (message.is_error || message.subtype !== "success") throw resultError(message);
        if (message.stop_reason === "refusal")
          throw new ProviderError("The model declined to title.");
        return titleFrom(text(message.result));
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      session.close();
    }
  };
}
