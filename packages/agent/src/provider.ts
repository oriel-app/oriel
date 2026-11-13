// Stateful so a provider can keep what only it understands: signed thinking blocks, which must
// go back unchanged, or a local harness's running process.
import type { Log } from "@oriel/core";

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
};

export type ToolCall = { id: string; name: string; input: unknown };

export type ToolResult = { callId: string; content: string; isError: boolean };

// Source content goes only in `tool` results, never in `user` or `assistant` text the loop writes.
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

export type Stop = "done" | "calls" | "max-tokens" | "refused" | "other";

export type ModelEvent =
  | { kind: "text"; text: string }
  | { kind: "usage"; usage: Usage }
  | { kind: "call"; call: ToolCall }
  | { kind: "end"; stop: Stop; detail: string | null; model: string; usage: Usage };

export type ConversationRequest = {
  // Constant: it never holds source content.
  system: string;
  tools: readonly ToolSpec[];
  messages: readonly ModelMessage[];
  signal: AbortSignal;
  // A provider logs no source content and no credential.
  log: Log;
};

export interface Conversation {
  next(
    results: readonly ToolResult[],
    options: { maxOutputTokens: number },
  ): AsyncIterable<ModelEvent>;
  close?(): void;
}

export interface Provider {
  converse(request: ConversationRequest): Conversation;
}

// It reaches the person, so it never holds a credential.
export class ProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

// fetch's own "fetch failed" leaves out what failed; its cause says.
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = causeOf(error);
  return cause ? `${error.message} (${cause})` : error.message;
}

export function causeOf(error: unknown): string | null {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (cause === undefined || cause === null) return null;
  if (typeof cause === "object" && "code" in cause && typeof cause.code === "string")
    return cause.code;
  if (cause instanceof Error) return cause.message || cause.name;
  return typeof cause === "string" ? cause : null;
}

export const noUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
