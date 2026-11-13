// Only the live transport holds the API key, so cassettes and the judge see requests without it.
import { apiVersion, messagesUrl } from "@oriel/agent";
import { array, literal, nullable, object, optional, string } from "@oriel/core";

export type Fetch = typeof fetch;

export { apiVersion, messagesUrl };

export function isMessagesRequest(request: Request): boolean {
  return request.method === "POST" && request.url === messagesUrl;
}

export { anthropicKey } from "@oriel/agent";

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

export function requestModel(body: string): string | null {
  const shaped = named(parseJson(body));
  return shaped.ok ? shaped.value.model : null;
}

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

const family = (id: string) => id.trim().replace(/-(\d{8}|latest)$/, "");
export const sameModel = (a: string, b: string) => family(a) === family(b);

export const messagesResponse = object({
  model: string,
  stop_reason: nullable(string),
  content: array(object({ type: string, text: optional(string) })),
});

// A stream's later usage counts replace the earlier ones: the API sends running totals.
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

// A cache write costs 1.25 times the input rate.
const prices: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const isPriced = (model: string) => Object.hasOwn(prices, family(model));

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
