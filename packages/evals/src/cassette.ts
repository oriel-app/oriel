// Record and replay for model calls. A cassette is one Messages API exchange,
// stored as `<key>.json`, where the key is a hash of the request's method, URL
// and body. Headers are neither stored nor hashed, so no API key can land in a
// cassette and a replay needs none. Cassettes live under `tests/cassettes/`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Infer, number, object, string, unknown } from "@oriel/core";
import { type Fetch, isMessagesRequest, messagesUrl, requestModel } from "./anthropic.ts";
import { canonicalJson } from "./canonical.ts";

const cassette = object({
  request: object({ method: string, url: string, body: unknown }),
  // A JSON body is stored parsed; a streamed body is stored as its text.
  response: object({ status: number, body: unknown }),
});
export type Cassette = Infer<typeof cassette>;

export function cassetteKey(request: Cassette["request"]): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

// Replay never touches the network. Record always calls `live` and rewrites
// the cassette for each successful response; a failed one is passed through
// unrecorded, so a rate limit never becomes a fixture.
export type CassetteOptions =
  | { mode: "replay"; dir: URL }
  | { mode: "record"; dir: URL; live: Fetch };

export function cassetteFetch(options: CassetteOptions): Fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (!isMessagesRequest(request))
      throw new Error(
        `cassettes hold only POST ${messagesUrl}, not ${request.method} ${request.url}`,
      );
    const text = await request.text();
    const recorded = { method: request.method, url: request.url, body: parseBody(text) };
    const key = cassetteKey(recorded);
    const file = new URL(`${key}.json`, options.dir);
    if (options.mode === "replay") return replay(file, key, requestModel(text));

    const response = await options.live(messagesUrl, {
      method: "POST",
      headers: request.headers,
      body: text,
      signal: request.signal,
    });
    if (!response.ok) return response;
    const body = await response.text();
    const json = response.headers.get("content-type")?.includes("application/json") ?? false;
    const stored: Cassette = {
      request: recorded,
      response: { status: response.status, body: json ? JSON.parse(body) : body },
    };
    mkdirSync(options.dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
    return respond(stored.response);
  };
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("a Messages API request body must be JSON");
  }
}

function replay(file: URL, key: string, model: string | null): Response {
  if (!existsSync(file)) {
    throw new Error(
      `no cassette for this ${model ?? "model"} request: ${fileURLToPath(file)} is missing. ` +
        "The request changed or was never recorded; record it with `pnpm evals`.",
    );
  }
  const parsed = cassette(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) {
    const issues = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw new Error(`${fileURLToPath(file)} is not a cassette:\n${issues.join("\n")}`);
  }
  if (cassetteKey(parsed.value.request) !== key)
    throw new Error(`${fileURLToPath(file)} holds a different request than its name says`);
  return respond(parsed.value.response);
}

function respond(response: Cassette["response"]): Response {
  const text = typeof response.body === "string";
  return new Response(text ? String(response.body) : JSON.stringify(response.body), {
    status: response.status,
    headers: { "content-type": text ? "text/event-stream" : "application/json" },
  });
}
