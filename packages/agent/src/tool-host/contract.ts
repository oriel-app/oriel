// SPIKE (effect-spike, not for main): decision 0060's tool host, the one
// shape both versions build, plain.ts and effect.ts, so one test runs on
// both. A tool host is a Claude Code process that calls MCP tools through
// its `mcp_call` control request, with no model: it checks at start what the
// CLI loaded, makes one call at a time, gives each its own deadline, stops a
// call when the run that made it ends, sends nothing queued behind it, and
// kills the process (SIGTERM, then SIGKILL) when it closes.
import type { ToolAnswer } from "@oriel/core";

export type Message = Record<string, unknown>;

// A server the host may call, as a person granted it: its name in the
// person's Claude Code and the URL the agent reported for it.
export type Grant = { name: string; url: string };

export type ToolCall = { server: string; tool: string; args: unknown };

export type ToolHostOptions = {
  // The CLI and its flags; the fake in tests.
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  grants: readonly Grant[];
  // The caller's list: the only tools it sends.
  tools: readonly { server: string; tool: string }[];
  // How long the start checks may take, each call may take, and a process
  // has between SIGTERM and SIGKILL.
  startMs: number;
  callMs: number;
  graceMs: number;
};

export type ToolHost = {
  // Rejects with CallFailed; `sent` says whether the call may have reached
  // the server. Aborting `signal` (the run ended) stops the call.
  call(call: ToolCall, signal?: AbortSignal): Promise<ToolAnswer>;
  // Kills the process, then removes its folder. Safe to call twice.
  close(): Promise<void>;
  // For tests.
  pid: number;
  dir: string;
};

export type OpenToolHost = (options: ToolHostOptions, signal?: AbortSignal) => Promise<ToolHost>;

// The host didn't start, or refused what the CLI reported.
export class HostRefused extends Error {
  readonly _tag = "HostRefused";
  constructor(message: string) {
    super(message);
    this.name = "HostRefused";
  }
}

// A call that failed. With `sent` false nothing reached the server, so a
// replay may send it again; with `sent` true it may have landed.
export class CallFailed extends Error {
  readonly _tag = "CallFailed";
  readonly sent: boolean;
  constructor(message: string, sent: boolean) {
    super(message);
    this.name = "CallFailed";
    this.sent = sent;
  }
}

export const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export const capability = "mcp_call_result_not_for_model_v1";

// Why what the CLI reported at start isn't what Oriel asked for, or null.
export function checkStart(
  init: Message,
  status: Message,
  hooks: Message,
  grants: readonly Grant[],
): string | null {
  const capabilities = Array.isArray(init.capabilities) ? init.capabilities : [];
  if (!capabilities.includes(capability)) return "update Claude Code";
  const servers = Array.isArray(status.mcpServers) ? status.mcpServers.filter(isObject) : [];
  if (servers.length !== grants.length) return "it loaded servers Oriel didn't name";
  for (const grant of grants) {
    const found = servers.find((server) => server.name === grant.name);
    const config = isObject(found?.config) ? found.config : {};
    if (!found || text(config.url) !== grant.url) return `${grant.name} isn't where it was granted`;
    if (found.status !== "connected") return `${grant.name} isn't connected`;
  }
  const policy = isObject(hooks.policy) ? hooks.policy : {};
  const listed = Array.isArray(hooks.hooks) ? hooks.hooks.filter(isObject) : [];
  if (policy.allDisabled !== true || listed.some((hook) => hook.disabled !== true))
    return "your organisation's Claude Code settings run hooks";
  return null;
}

export const onList = (options: ToolHostOptions, call: ToolCall) =>
  options.tools.some((each) => each.server === call.server && each.tool === call.tool);

export const callRequest = (call: ToolCall): Message => ({
  subtype: "mcp_call",
  server_name: call.server,
  tool_name: call.tool,
  arguments: call.args,
  result_not_for_model: true,
});

// Oriel's answer to every request the CLI sends: declined.
export const declined = (request: Message): Message => ({
  type: "control_response",
  response: {
    subtype: "error",
    request_id: request.request_id,
    error: "Oriel declines this request.",
  },
});

// 0060's caps: text blocks only, up to 100,000 characters an answer, the cut
// marked; anything else dropped, with a note.
export const mostChars = 100_000;
export function capped(response: Message): ToolAnswer {
  const result = isObject(response.result) ? response.result : {};
  const blocks = Array.isArray(result.content) ? result.content.filter(isObject) : [];
  let left = mostChars;
  let dropped = 0;
  let cut = false;
  const content: { type: "text"; text: string }[] = [];
  for (const block of blocks) {
    if (block.type !== "text") {
      dropped += 1;
      continue;
    }
    const whole = text(block.text);
    // A block past the allowance is cut whole, and marked as one cut is.
    const kept = whole.slice(0, Math.max(left, 0));
    left -= kept.length;
    if (kept.length < whole.length) cut = true;
    if (kept) content.push({ type: "text", text: kept });
  }
  if (cut) content.push({ type: "text", text: "[cut by Oriel]" });
  if (dropped) content.push({ type: "text", text: `[Oriel dropped ${dropped} non-text blocks]` });
  return { content, ...(result.isError === true ? { isError: true } : {}) };
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
