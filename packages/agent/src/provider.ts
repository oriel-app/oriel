// What the agent loop needs from a model: one conversation per turn, streamed
// one response at a time. The loop owns the tool, the caps, the runs and the
// history; a provider owns only how messages reach a model and come back.
//
// A conversation is stateful so that a provider can keep what only it
// understands: the Messages API's signed thinking blocks, which must go back
// unchanged within a turn, or a local harness's running process, which keeps
// its own history and answers its tool calls from `next`'s results. Neither
// shape leaks into the loop.
import type { Log } from "@oriel/core";

export type ToolSpec = {
  name: string;
  description: string;
  // JSON Schema for the tool's input.
  inputSchema: Readonly<Record<string, unknown>>;
};

// `input` is what the model sent, parsed, or the raw text when it isn't JSON.
// The loop checks it before acting on it.
export type ToolCall = { id: string; name: string; input: unknown };

export type ToolResult = { callId: string; content: string; isError: boolean };

// The thread as the model sees it, oldest first. Source content goes only in
// `tool` results, never in `user` or `assistant` text the loop writes.
export type ModelMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: readonly ToolCall[] }
  | { role: "tool"; results: readonly ToolResult[] };

// `inputTokens` counts every input token, whether it was read from the cache,
// written to it, or neither; the cache counts say how many of them were which.
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

// Why a response ended. "calls": it asked for tool calls. "max-tokens": it was
// cut off, so any call in it may be incomplete. "refused": the model or its
// safety checks declined. "other": anything else, named in `detail`.
export type Stop = "done" | "calls" | "max-tokens" | "refused" | "other";

// One response, in order: text as it arrives, then each complete tool call,
// then exactly one `end`. `model` is the model that served the response.
export type ModelEvent =
  | { kind: "text"; text: string }
  | { kind: "call"; call: ToolCall }
  | { kind: "end"; stop: Stop; detail: string | null; model: string; usage: Usage };

export type ConversationRequest = {
  // Constant: it never holds source content.
  system: string;
  tools: readonly ToolSpec[];
  messages: readonly ModelMessage[];
  signal: AbortSignal;
  // Bound to the thread already. A provider logs no content and no credential.
  log: Log;
};

export interface Conversation {
  // The model's next response. The first call sends the request's messages;
  // each later one first sends the results of the calls the previous response
  // made. On abort it rejects with the signal's reason; on any other failure,
  // with a `ProviderError`.
  next(results: readonly ToolResult[]): AsyncIterable<ModelEvent>;
}

export interface Provider {
  converse(request: ConversationRequest): Conversation;
}

// A failure a person can read: what went wrong reaching the model, never a
// credential.
export class ProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export const noUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
