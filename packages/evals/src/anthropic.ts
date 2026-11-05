// The one endpoint evals reach: the Anthropic Messages API, over plain fetch.
// Only the live transport holds the API key, so everything above it (the
// cassettes, the system under test and the judge) sees requests without it.
import { apiVersion, messagesUrl } from "@oriel/agent";
import { array, literal, nullable, object, optional, string } from "@oriel/core";

export type Fetch = typeof fetch;

// The server's endpoint and API version, so evals test what it sends.
export { apiVersion, messagesUrl };

export function isMessagesRequest(request: Request): boolean {
  return request.method === "POST" && request.url === messagesUrl;
}

// The server's reader, so both refuse the same keys.
export { anthropicKey } from "@oriel/agent";

// Adds the key and the API version to each Messages API request. `network`
// is the real fetch outside tests.
export function anthropicFetch(apiKey: string, network: Fetch = fetch): Fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (!isMessagesRequest(request))
      throw new Error(`evals reach only POST ${messagesUrl}, not ${request.method} ${request.url}`);
    const headers = new Headers(request.headers);
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", apiVersion);
    headers.set("content-type", "application/json");
    return network(messagesUrl, {
      method: "POST",
      headers,
      body: await request.text(),
      signal: request.signal,
    });
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const named = object({ model: string });
const messageStart = object({ type: literal("message_start"), message: named });

// The model a request body names, or null when it names none.
export function requestModel(body: string): string | null {
  const shaped = named(parseJson(body));
  return shaped.ok ? shaped.value.model : null;
}

// The model a response reports it is, from a JSON body or from a stream's
// `message_start` event; null when it reports none.
export function responseModel(body: string): string | null {
  const shaped = named(parseJson(body));
  if (shaped.ok) return shaped.value.model;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = messageStart(parseJson(line.slice("data:".length)));
    if (event.ok) return event.value.message.model;
  }
  return null;
}

// An alias and its dated snapshots (`claude-x-5` and `claude-x-5-20261001`)
// are one model.
const family = (id: string) => id.trim().replace(/-(\d{8}|latest)$/, "");
export const sameModel = (a: string, b: string) => family(a) === family(b);

// The parts of a Messages API response evals read.
export const messagesResponse = object({
  model: string,
  stop_reason: nullable(string),
  content: array(object({ type: string, text: optional(string) })),
});

// The tokens a response bills, from a JSON body's `usage` or from a stream's
// `message_start` and `message_delta` events, the later counts replacing the
// earlier as the API sends them. All zero when it reports none.
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function responseUsage(body: string): Usage {
  const counts: Record<string, unknown> = {};
  const take = (usage: unknown) => {
    if (typeof usage === "object" && usage !== null) Object.assign(counts, usage);
  };
  const json = parseJson(body);
  if (typeof json === "object" && json !== null && "usage" in json) take(json.usage);
  else
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const event = parseJson(line.slice("data:".length));
      if (typeof event !== "object" || event === null) continue;
      if ("message" in event && typeof event.message === "object" && event.message !== null)
        take(Reflect.get(event.message, "usage"));
      if ("usage" in event) take(event.usage);
    }
  const count = (key: string) => {
    const value = counts[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return {
    input: count("input_tokens"),
    output: count("output_tokens"),
    cacheRead: count("cache_read_input_tokens"),
    cacheWrite: count("cache_creation_input_tokens"),
  };
}

// Dollars per million tokens, as Anthropic lists them. A cache write costs
// 1.25 times the input rate.
const prices: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Up to 100K tokens a prompt; Noticed's prompts stay far below.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const isPriced = (model: string) => Object.hasOwn(prices, family(model));

// What a response's tokens cost on `model`, in dollars; null for a model
// with no listed price.
export function cost(model: string, usage: Usage): number | null {
  const price = prices[family(model)];
  if (!price) return null;
  const dollars =
    usage.input * price.input +
    usage.cacheWrite * price.input * 1.25 +
    usage.cacheRead * price.cacheRead +
    usage.output * price.output;
  return dollars / 1e6;
}
