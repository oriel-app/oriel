// With `result_not_for_model` the CLI hands each answer to Oriel alone, copying nothing under the
// person's `~/.claude`.
import { createInterface } from "node:readline";
import { type Log, type ToolAnswer, WriteStalled } from "@oriel/core";
import {
  type ClaudeCode,
  devConfig,
  harnessEnv,
  parseVersion,
  supportedVersion,
} from "./claude-code.ts";
import type { DevServer } from "./codex.ts";
import { type Ended, supervise } from "./process.ts";
import { ProviderError } from "./provider.ts";

type Message = Record<string, unknown>;
const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type Grant =
  | { name: string; url: string }
  | { name: string; command: string; args: readonly string[] };

export type Listed = { server: string; tool: string };
export type HostCall = Listed & { args: Readonly<Record<string, unknown>> };

export type ToolHostOptions = {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  grants: readonly Grant[];
  tools: readonly Listed[];
  log: Log;
  startMs?: number;
  callMs?: number;
  graceMs?: number;
};

export type ToolHost = {
  // A refusal before anything was sent is a `WriteStalled`; a failure once the call may have
  // reached the server is a `ProviderError`.
  call(call: HostCall, signal?: AbortSignal): Promise<ToolAnswer>;
  close(): Promise<void>;
  pid: number;
  dir: string;
};

export class HostRefused extends WriteStalled {
  constructor(message: string) {
    super(message);
    this.name = "HostRefused";
  }
}

export const capability = "mcp_call_result_not_for_model_v1";

// Claude Code names a tool `mcp__<server>__<tool>`, splitting at the first `__` after `mcp__` and
// changing anything outside `[A-Za-z0-9_-]` to `_`: null for a pair that wouldn't parse back.
export function fullName(server: string, tool: string): string | null {
  const plain = /^[A-Za-z0-9_-]+$/;
  if (!plain.test(server) || !plain.test(tool)) return null;
  if (server.includes("__") || server.endsWith("_") || tool.startsWith("_")) return null;
  return `mcp__${server}__${tool}`;
}

export function toolHostArgs(grants: readonly Grant[], dev: readonly DevServer[] = []): string[] {
  const standIns = dev.filter((each) => grants.some((grant) => grant.name === each.name));
  return [
    ...(standIns.length ? ["--mcp-config", JSON.stringify(devConfig(standIns))] : []),
    "-p",
    // Which stream-json output needs.
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--tools",
    "",
    "--setting-sources",
    "user",
    "--settings",
    JSON.stringify({
      disableAllHooks: true,
      allowedMcpServers: grants.map((grant) => ({ serverName: grant.name })),
    }),
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
}

const placed = (grant: Grant, config: Message): boolean => {
  if ("url" in grant) return text(config.url) === grant.url;
  const args = Array.isArray(config.args) ? config.args.map(text) : null;
  return (
    text(config.command) === grant.command &&
    args !== null &&
    args.length === grant.args.length &&
    args.every((each, at) => each === grant.args[at])
  );
};

export function checkStart(
  init: Message,
  status: Message,
  hooks: Message,
  grants: readonly Grant[],
): string | null {
  const version = parseVersion(text(init.claude_code_version));
  const capabilities = Array.isArray(init.capabilities) ? init.capabilities : [];
  if (!version || !supportedVersion(version) || !capabilities.includes(capability))
    return "this Claude Code can't call a server's tools for Oriel. Update Claude Code";
  const servers = Array.isArray(status.mcpServers) ? status.mcpServers.filter(isObject) : [];
  if (servers.length !== grants.length) return "Claude Code loaded servers Oriel didn't name";
  for (const grant of grants) {
    const found = servers.find((server) => server.name === grant.name);
    if (!found || !placed(grant, isObject(found.config) ? found.config : {}))
      return `${grant.name} isn't where it was when it was turned on`;
    if (found.status === "needs-auth")
      return `${grant.name} needs signing in. Sign in to it in Claude Code`;
    if (found.status !== "connected") return `${grant.name} didn't connect in Claude Code`;
  }
  const policy = isObject(hooks.policy) ? hooks.policy : {};
  const listed = Array.isArray(hooks.hooks) ? hooks.hooks : [];
  if (
    policy.allDisabled !== true ||
    listed.some((hook) => !isObject(hook) || hook.disabled !== true)
  )
    return "your organisation's Claude Code settings run hooks, which would see a server's answers";
  return null;
}

const declined = (request: Message): Message => ({
  type: "control_response",
  response: {
    subtype: "error",
    request_id: request.request_id,
    error: "Oriel declines this request.",
  },
});

// The CLI's words when it refused before the server was asked: nothing was sent.
const unsentSaid = [
  /^MCP server not connected: /,
  /^Not a fully-qualified MCP tool name/,
  /^mcp_call: /,
  /^mcp_call does not support /,
  /^staged mcp_call is disabled/,
  / requires authentication /,
];
// The CLI's words when the call went out and stopped without an answer: it may have landed.
const lostSaid = [
  /^mcp_call cancelled by client/,
  /^MCP session expired for /,
  /^URL elicitation required/,
  /^MCP server .* (sent a response over|sent a message that was too large)/,
];

function answerOf(response: Message): ToolAnswer {
  const answer = isObject(response.response) ? response.response : {};
  return {
    content: Array.isArray(answer.content) ? answer.content : [],
    ...(answer.structuredContent !== undefined && answer.structuredContent !== null
      ? { structuredContent: answer.structuredContent }
      : {}),
    ...(answer.isError === true ? { isError: true } : {}),
  };
}

export function failedAnswer(tool: string, error: string): ToolAnswer {
  if (unsentSaid.some((said) => said.test(error)))
    throw new WriteStalled(`Claude Code didn't send ${tool}: ${error.slice(0, 300)}`);
  if (lostSaid.some((said) => said.test(error)))
    throw new ProviderError(`${tool} got no answer: ${error.slice(0, 300)}`);
  return { content: [{ type: "text", text: error }], isError: true };
}

const endedSaid = (ended: Ended) =>
  "error" in ended
    ? `Oriel couldn't start Claude Code: ${ended.error}`
    : `Claude Code stopped (${ended.signal ?? `exit code ${ended.code}`})`;

function bounded<T>(
  work: Promise<T>,
  ms: number,
  late: () => Error,
  signal: AbortSignal | undefined,
  aborted: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(late()), ms);
    const onAbort = () => reject(aborted());
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

export async function openToolHost(
  options: ToolHostOptions,
  signal?: AbortSignal,
): Promise<ToolHost> {
  const startMs = options.startMs ?? 30_000;
  const callMs = options.callMs ?? 2 * 60 * 1000;
  const {
    child,
    dir,
    ended,
    close: stop,
  } = supervise({
    command: options.command,
    args: options.args,
    env: options.env,
    graceMs: options.graceMs ?? 2_000,
  });
  const pending = new Map<string, PromiseWithResolvers<Message>>();
  let gone: Error | null = null;
  let requested = 0;
  const end = (why: Error) => {
    gone ??= why;
    for (const waiting of pending.values()) waiting.reject(gone);
    pending.clear();
  };
  void ended.then((how) => end(new ProviderError(endedSaid(how))));
  // Its own words go nowhere: they may hold a server's.
  child.stderr.resume();

  const send = (message: Message) => {
    if (!gone) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message) || gone) return;
    if (message.type === "control_request") {
      options.log("tool host: declined a request of Claude Code's", {
        subtype: isObject(message.request) ? text(message.request.subtype) : "",
      });
      return send(declined(message));
    }
    if (message.type !== "control_response" || !isObject(message.response)) return;
    const response = message.response;
    const id = text(response.request_id);
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    waiting.resolve(response);
  });
  const request = (body: Message): Promise<Message> => {
    if (gone) return Promise.reject(gone);
    const id = `oriel-${++requested}`;
    const waiting = Promise.withResolvers<Message>();
    pending.set(id, waiting);
    send({ type: "control_request", request_id: id, request: body });
    return waiting.promise;
  };
  const success = async (body: Message): Promise<Message> => {
    const response = await request(body);
    if (response.subtype !== "success")
      throw new HostRefused(`Claude Code refused ${text(body.subtype)}: ${text(response.error)}`);
    return isObject(response.response) ? response.response : {};
  };

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      end(new WriteStalled("Oriel closed the tool host"));
      await stop();
    })());

  try {
    const why = await bounded(
      (async () => {
        const init = await success({ subtype: "initialize" });
        let status = await success({ subtype: "mcp_status" });
        const connecting = () =>
          Array.isArray(status.mcpServers) &&
          status.mcpServers.some((each) => isObject(each) && each.status === "pending");
        while (connecting()) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          status = await success({ subtype: "mcp_status" });
        }
        const hooks = await success({ subtype: "get_hooks_listing" });
        return checkStart(init, status, hooks, options.grants);
      })(),
      startMs,
      () => new HostRefused("Claude Code didn't answer its start checks in time"),
      signal,
      () => new HostRefused("Oriel stopped the tool host before it started"),
    );
    if (why) throw new HostRefused(`Oriel can't call through Claude Code: ${why}.`);
  } catch (error) {
    await close();
    throw error instanceof HostRefused ? error : new HostRefused(messageOf(error));
  }

  let queue: Promise<unknown> = Promise.resolve();
  const unsent = (why: string) => new WriteStalled(why);

  const once = async (call: HostCall, name: string, callSignal?: AbortSignal) => {
    if (gone || closing) throw unsent("the tool host is closed");
    if (callSignal?.aborted) throw unsent("the run ended before this call was sent");
    let response: Message;
    try {
      response = await bounded(
        request({
          subtype: "mcp_call",
          tool: name,
          arguments: call.args,
          result_not_for_model: true,
        }),
        callMs,
        () => new ProviderError(`${call.tool} took longer than ${callMs} ms`),
        callSignal,
        () => new ProviderError("the run ended while this call was out"),
      );
    } catch (error) {
      // A call that's out can only be stopped by ending its process.
      void close();
      throw error instanceof ProviderError ? error : new ProviderError(messageOf(error));
    }
    return response.subtype === "success"
      ? answerOf(response)
      : failedAnswer(call.tool, text(response.error));
  };

  return {
    pid: child.pid ?? -1,
    dir,
    close,
    call(call, callSignal) {
      const name = fullName(call.server, call.tool);
      const listed = options.tools.some(
        (each) => each.server === call.server && each.tool === call.tool,
      );
      if (!name || !listed)
        return Promise.reject(unsent(`${call.tool} isn't a tool this caller may send`));
      let started = false;
      const turn = queue.then(() => {
        started = true;
        return once(call, name, callSignal);
      });
      queue = turn.catch(() => {});
      if (!callSignal) return turn;
      // A queued call fails as soon as its run ends, not when the call
      // ahead settles; `once` then sees the abort and sends nothing.
      return new Promise<ToolAnswer>((resolve, reject) => {
        const onAbort = () => {
          if (!started) reject(unsent("the run ended before this call was sent"));
        };
        if (callSignal.aborted) onAbort();
        callSignal.addEventListener("abort", onAbort, { once: true });
        turn.then(resolve, reject).finally(() => callSignal.removeEventListener("abort", onAbort));
      });
    },
  };
}

export const claudeCodeToolHost = (
  cli: ClaudeCode,
  given: {
    grants: readonly Grant[];
    tools: readonly Listed[];
    dev?: readonly DevServer[];
    parent: Readonly<Record<string, string | undefined>>;
    log: Log;
  },
  signal?: AbortSignal,
): Promise<ToolHost> =>
  openToolHost(
    {
      command: cli.path,
      args: toolHostArgs(given.grants, given.dev),
      env: harnessEnv(given.parent, 1),
      grants: given.grants,
      tools: given.tools,
      log: given.log,
    },
    signal,
  );
