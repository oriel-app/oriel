// The one endpoint evals reach: the Anthropic Messages API, over plain fetch.
// Only the live transport holds the API key, so everything above it (the
// cassettes, the system under test and the judge) sees requests without it.
import { parseEnv } from "node:util";
import { array, nullable, object, optional, string } from "@oriel/core";

export type Fetch = typeof fetch;

export const messagesUrl = "https://api.anthropic.com/v1/messages";
export const apiVersion = "2026-10-21";

export function isMessagesRequest(request: Request): boolean {
  return request.method === "POST" && request.url === messagesUrl;
}

// Reads ANTHROPIC_API_KEY and nothing else. Callers never print its value.
export function anthropicKey(envFile: string | null): string | null {
  const key = envFile ? parseEnv(envFile).ANTHROPIC_API_KEY : undefined;
  return key?.trim() ? key : null;
}

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

// The model a request body names, or null when it names none.
export function requestModel(body: string): string | null {
  try {
    const shaped = object({ model: optional(string) })(JSON.parse(body));
    return shaped.ok ? (shaped.value.model ?? null) : null;
  } catch {
    return null;
  }
}

// The parts of a Messages API response evals read.
export const messagesResponse = object({
  model: string,
  stop_reason: nullable(string),
  content: array(object({ type: string, text: optional(string) })),
});
