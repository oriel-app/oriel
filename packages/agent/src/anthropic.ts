// The API key stays in this closure: sent as a header, never logged, put in an error or kept
// on an object.
import type { Log } from "@oriel/core";
import { parseEnv } from "node:util";
import {
  causeOf,
  type Conversation,
  type ConversationRequest,
  errorText,
  type ModelEvent,
  type ModelMessage,
  type Provider,
  ProviderError,
  type Stop,
  type ToolCall,
  type ToolResult,
  type Usage,
} from "./provider.ts";

export const messagesUrl = "https://api.anthropic.com/v1/messages";
// On this version, a request that sends `temperature`, `top_p` or `top_k` is
// refused; this provider sends none.
export const apiVersion = "2026-10-21";
export const defaultModel = "claude-opus-5-5";
export const fallbackBeta = "server-side-fallback-2026-07-01";

// A key with whitespace or non-printable ASCII is refused, not trimmed: a header can't hold it,
// and the error saying so would quote it.
export function anthropicKey(envFile: string | null): string | null {
  const key = envFile ? parseEnv(envFile).ANTHROPIC_API_KEY : undefined;
  return key && /^[!-~]+$/.test(key) ? key : null;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  fallbacks?: boolean;
  fetch?: typeof fetch;
  wait?: Wait;
};

type Block = Record<string, unknown> & { type: string };
type ApiMessage = { role: "user" | "assistant"; content: Block[] };

export type Reply = {
  content: Block[];
  calls: ToolCall[];
  stop: Stop;
  detail: string | null;
  model: string;
  usage: Usage;
};

const ephemeral = { type: "ephemeral" } as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : "");

const malformed = (what: string) =>
  new ProviderError(`The model provider sent a response Oriel can't read: ${what}.`);

// The API takes a conversation that opens with the user; one that opens with Oriel's note gets
// this line before it.
export const threadOpens = "(Oriel: the thread starts here.)";

function toApi(messages: readonly ModelMessage[]): ApiMessage[] {
  const opening: ApiMessage[] =
    messages[0]?.role === "assistant"
      ? [{ role: "user", content: [{ type: "text", text: threadOpens }] }]
      : [];
  return [...opening, ...apiMessages(messages)];
}

function apiMessages(messages: readonly ModelMessage[]): ApiMessage[] {
  return messages.flatMap((message): ApiMessage[] => {
    if (message.role === "user")
      return [{ role: "user", content: [{ type: "text", text: message.text }] }];
    if (message.role === "tool") return [{ role: "user", content: message.results.map(result) }];
    // The API refuses a text block that is empty or only whitespace.
    const content: Block[] = message.text.trim() ? [{ type: "text", text: message.text }] : [];
    for (const call of message.calls)
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    return content.length ? [{ role: "assistant", content }] : [];
  });
}

function result(r: ToolResult): Block {
  const block: Block = { type: "tool_result", tool_use_id: r.callId, content: r.content };
  if (r.isError) block.is_error = true;
  return block;
}

async function* serverEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const parse = (lines: string[]) => {
    try {
      return JSON.parse(lines.join("\n")) as unknown;
    } catch {
      throw malformed("an event isn't JSON");
    }
  };
  try {
    for (let chunk = await reader.read(); ; chunk = await reader.read()) {
      buffer += chunk.done
        ? decoder.decode() + "\n\n"
        : decoder.decode(chunk.value, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (data.length) yield parse(data);
          data = [];
          continue;
        }
        if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
      }
      if (chunk.done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function usageOf(raw: Record<string, unknown>): Usage {
  const count = (u: Record<string, unknown>, key: string) =>
    typeof u[key] === "number" && Number.isFinite(u[key]) ? u[key] : 0;
  const one = (u: Record<string, unknown>): Usage => {
    const cacheReadTokens = count(u, "cache_read_input_tokens");
    const cacheWriteTokens = count(u, "cache_creation_input_tokens");
    return {
      inputTokens: count(u, "input_tokens") + cacheReadTokens + cacheWriteTokens,
      outputTokens: count(u, "output_tokens"),
      cacheReadTokens,
      cacheWriteTokens,
    };
  };
  // After a fallback, the top level covers only the attempt that answered;
  // `iterations` covers every attempt, the declined one included.
  const attempts = Array.isArray(raw.iterations) ? raw.iterations.filter(isObject) : [];
  const complete = attempts.every(
    (a) => typeof a.input_tokens === "number" && typeof a.output_tokens === "number",
  );
  if (!attempts.length || !complete) return one(raw);
  return attempts.map(one).reduce((sum, u) => ({
    inputTokens: sum.inputTokens + u.inputTokens,
    outputTokens: sum.outputTokens + u.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + u.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + u.cacheWriteTokens,
  }));
}

function stopOf(reason: string | null, calls: number): Stop {
  if (reason === "end_turn" || reason === "stop_sequence") return "done";
  if (reason === "tool_use") return calls ? "calls" : "done";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "max-tokens";
  if (reason === "refusal") return "refused";
  return "other";
}

const parseInput = (json: string): { ok: true; value: unknown } | { ok: false } => {
  if (json === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(json) as unknown };
  } catch {
    return { ok: false };
  }
};

// A thinking block goes back with its signature unchanged. After a fallback, only text from
// before the last fallback block goes back, and only calls after it run.
export async function* readResponse(
  events: AsyncIterable<unknown>,
  requested: string,
): AsyncGenerator<ModelEvent, Reply> {
  const blocks: { block: Block; json: string }[] = [];
  let model = requested;
  let usage: Record<string, unknown> = {};
  let reason: string | null = null;
  let category: string | null = null;
  let stopped = false;
  for await (const event of events) {
    if (!isObject(event)) throw malformed("an event isn't an object");
    if (event.type === "message_start") {
      const message = isObject(event.message) ? event.message : {};
      if (typeof message.model === "string") model = message.model;
      usage = isObject(message.usage) ? { ...message.usage } : {};
      yield { kind: "usage", usage: usageOf(usage) };
    } else if (event.type === "content_block_start") {
      const block = event.content_block;
      if (typeof event.index !== "number" || !isObject(block) || typeof block.type !== "string")
        throw malformed("a content block has no index or type");
      blocks[event.index] = { block: structuredClone(block) as Block, json: "" };
      if (block.type === "fallback" && isObject(block.to) && typeof block.to.model === "string")
        model = block.to.model;
    } else if (event.type === "content_block_delta") {
      const slot = typeof event.index === "number" ? blocks[event.index] : undefined;
      const delta = event.delta;
      if (!slot || !isObject(delta)) throw malformed("a delta for a block that never started");
      const { block } = slot;
      if (delta.type === "text_delta") {
        block.text = text(block.text) + text(delta.text);
        if (text(delta.text)) yield { kind: "text", text: text(delta.text) };
      } else if (delta.type === "thinking_delta") {
        block.thinking = text(block.thinking) + text(delta.thinking);
      } else if (delta.type === "signature_delta") {
        block.signature = text(block.signature) + text(delta.signature);
      } else if (delta.type === "input_json_delta") {
        slot.json += text(delta.partial_json);
      }
    } else if (event.type === "message_delta") {
      const delta = isObject(event.delta) ? event.delta : {};
      if (typeof delta.stop_reason === "string") reason = delta.stop_reason;
      const details = isObject(delta.stop_details) ? delta.stop_details : {};
      if (typeof details.category === "string") category = details.category;
      if (isObject(event.usage)) {
        Object.assign(usage, event.usage);
        yield { kind: "usage", usage: usageOf(usage) };
      }
    } else if (event.type === "message_stop") {
      stopped = true;
    } else if (event.type === "error") {
      const error = isObject(event.error) ? event.error : {};
      const why = text(error.message) || text(error.type) || "an unknown error";
      throw new ProviderError(`The model provider stopped its response: ${why}.`);
    }
  }
  if (!stopped) throw new ProviderError("The model provider's response ended early.");

  const ordered = blocks.filter((slot) => slot !== undefined);
  const boundary = ordered.findLastIndex((slot) => slot.block.type === "fallback");
  const content: Block[] = [];
  const calls: ToolCall[] = [];
  ordered.forEach(({ block, json }, i) => {
    if (block.type === "fallback" || (i < boundary && block.type !== "text")) return;
    if (block.type === "text" && !text(block.text).trim()) return;
    if (block.type === "tool_use") {
      if (typeof block.id !== "string" || typeof block.name !== "string")
        throw malformed("a tool call has no ID or name");
      const input = parseInput(json);
      block.input = input.ok ? input.value : {};
      calls.push({ id: block.id, name: block.name, input: input.ok ? input.value : json });
    }
    content.push(block);
  });
  return {
    content,
    calls,
    stop: stopOf(reason, calls.length),
    detail: reason === "refusal" ? category : reason,
    model,
    usage: usageOf(usage),
  };
}

export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

const timer: Wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const aborted = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });

// Only a failure before any response is retried: once a response streams,
// sending again could repeat a turn's text or its calls.
export const maxRetries = 2;
export const retryDelaysMs = [500, 2_000] as const;
export const maxRetryAfterMs = 20_000;

const retriedStatuses = new Set([429, 529]);

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  return header && /^\d+$/.test(header) ? Number(header) * 1000 : null;
}

export type MessagesOptions = {
  apiKey: string;
  beta?: string;
  fetch?: typeof fetch;
  wait?: Wait;
};

export function messagesSender(options: MessagesOptions) {
  const { apiKey } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const wait = options.wait ?? timer;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": apiVersion,
  };
  if (options.beta) headers["anthropic-beta"] = options.beta;
  const scrub = (message: string) => (apiKey ? message.replaceAll(apiKey, "[key]") : message);

  const refused = async (response: Response, what: string) => {
    const detail = await response.text().then(
      (body) => {
        try {
          const parsed: unknown = JSON.parse(body);
          const error = isObject(parsed) && isObject(parsed.error) ? parsed.error : {};
          return text(error.message);
        } catch {
          return "";
        }
      },
      () => "",
    );
    const said = detail ? `: ${detail}` : "";
    return new ProviderError(
      scrub(`The model provider refused ${what} (HTTP ${response.status})${said}`),
      response.status,
    );
  };

  return async (
    body: string,
    { signal, log, what = "the request" }: { signal: AbortSignal; log: Log; what?: string },
  ): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const last = attempt === maxRetries;
      let response: Response;
      try {
        response = await send(messagesUrl, { method: "POST", headers, body, signal });
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const cause = causeOf(error);
        // fetch fails with a TypeError when the network does; anything else
        // (an eval's missing cassette) won't go better a second time.
        if (last || !(error instanceof TypeError))
          throw new ProviderError(
            scrub(`Oriel couldn't reach the model provider: ${errorText(error)}`),
          );
        const ms = retryDelaysMs[attempt] ?? 0;
        log("provider.retry", { attempt: attempt + 1, cause: cause && scrub(cause), wait_ms: ms });
        await wait(ms, signal);
        continue;
      }
      if (response.ok) return response;
      const asked = retryAfterMs(response);
      const ms = asked ?? retryDelaysMs[attempt] ?? 0;
      if (last || !retriedStatuses.has(response.status) || ms > maxRetryAfterMs)
        throw await refused(response, what);
      await response.body?.cancel().catch(() => {});
      log("provider.retry", { attempt: attempt + 1, status: response.status, wait_ms: ms });
      await wait(ms, signal);
    }
  };
}

export function anthropicProvider(options: AnthropicOptions): Provider {
  const { apiKey } = options;
  const model = options.model ?? defaultModel;
  const ceiling = options.maxTokens ?? 64_000;
  const fallbacks = options.fallbacks ?? false;
  const post = messagesSender({
    apiKey,
    ...(fallbacks ? { beta: fallbackBeta } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.wait ? { wait: options.wait } : {}),
  });
  const scrub = (message: string) => (apiKey ? message.replaceAll(apiKey, "[key]") : message);

  return {
    converse(request: ConversationRequest): Conversation {
      const { signal, log } = request;
      const messages = toApi(request.messages);
      // The same bytes on every request of the turn, so the prompt cache holds.
      const fixed = {
        model,
        stream: true,
        system: [{ type: "text", text: request.system, cache_control: ephemeral }],
        tools: request.tools.map((tool, i, all) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
          strict: true,
          ...(i === all.length - 1 ? { cache_control: ephemeral } : {}),
        })),
        // One run per response, so each run's result is the model's to read
        // before it writes the next.
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        output_config: { effort: options.effort ?? "medium" },
        cache_control: ephemeral,
        ...(fallbacks ? { fallbacks: "default" } : {}),
      };
      return {
        async *next(results, { maxOutputTokens }) {
          if (results.length) messages.push({ role: "user", content: results.map(result) });
          signal.throwIfAborted();
          // Not part of the cached prefix, so it can shrink as the thread's
          // tokens run down.
          const maxTokens = Math.max(1, Math.floor(Math.min(ceiling, maxOutputTokens)));
          log("provider.request", { model, messages: messages.length, max_tokens: maxTokens });
          const response = await post(
            JSON.stringify({ ...fixed, max_tokens: maxTokens, messages }),
            { signal, log },
          );
          const { body } = response;
          if (!body) throw new ProviderError("The model provider sent an empty response.");
          let reply: Reply;
          try {
            reply = yield* readResponse(serverEvents(body), model);
          } catch (error) {
            if (signal.aborted) throw signal.reason;
            if (error instanceof ProviderError) throw new ProviderError(scrub(error.message));
            throw new ProviderError(
              `The model provider's response couldn't be read: ${scrub(errorText(error))}`,
            );
          }
          if (reply.content.length) messages.push({ role: "assistant", content: reply.content });
          log("provider.response", { model: reply.model, stop: reply.stop });
          for (const call of reply.calls) yield { kind: "call", call };
          const { stop, detail, usage } = reply;
          yield { kind: "end", stop, detail, model: reply.model, usage };
        },
      };
    },
  };
}
