// Record and replay for model calls. A cassette is one Messages API exchange,
// stored as `<key>.json`, where the key is a hash of the request's method, URL
// and body. Headers are neither stored nor hashed, so no API key can land in a
// cassette and a replay needs none.
//
// Cassettes live in `tests/cassettes/<case>/<model>+<judge>/`, one set per
// pair of model under test and judge, so a round with other models never
// touches the set CI replays. Commit cassettes with the code that recorded
// them: any change to what the system under test sends changes their keys, and
// CI replays only what is committed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Names that are safe as one path segment.
const segment = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.*$/, "_");

// One case's cassettes for one model under test and one judge.
export function cassetteDir(root: URL, caseId: string, model: string, judge: string): URL {
  return new URL(`${segment(caseId)}/${segment(model)}+${segment(judge)}/`, root);
}

// One case's cassettes, in their own directory. Replay reads them and never
// touches the network. Record calls `live` for every request and keeps each
// successful exchange in memory; a failed one is passed through unrecorded,
// so a rate limit never becomes a fixture. `commit` then replaces the
// directory's cassettes with exactly the kept ones. Call it only once the case
// has finished without error, so a case that fails partway keeps its last good
// recording. It also refuses, and says why, when a response went unrecorded:
// that case wouldn't replay. In replay, `commit` does nothing.
export type CassetteOptions =
  | { mode: "replay"; dir: URL }
  | { mode: "record"; dir: URL; live: Fetch };

// `commit` returns why it saved nothing, or null once saved (or in replay).
export type Cassettes = { fetch: Fetch; commit: () => string | null };

export function cassettes(options: CassetteOptions): Cassettes {
  const kept = new Map<string, Cassette>();
  const unrecorded: number[] = [];
  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    if (!isMessagesRequest(request))
      throw new Error(
        `cassettes hold only POST ${messagesUrl}, not ${request.method} ${request.url}`,
      );
    const text = await request.text();
    const recorded = { method: request.method, url: request.url, body: parseBody(text) };
    const key = cassetteKey(recorded);
    if (options.mode === "replay")
      return replay(new URL(`${key}.json`, options.dir), key, requestModel(text));

    const response = await options.live(messagesUrl, {
      method: "POST",
      headers: request.headers,
      body: text,
      signal: request.signal,
    });
    if (!response.ok) {
      unrecorded.push(response.status);
      return response;
    }
    const body = await response.text();
    const json = response.headers.get("content-type")?.includes("application/json") ?? false;
    const stored: Cassette = {
      request: recorded,
      response: { status: response.status, body: json ? JSON.parse(body) : body },
    };
    kept.set(key, stored);
    return respond(stored.response);
  };
  const commit = () => {
    if (options.mode === "replay") return null;
    if (unrecorded.length) {
      const statuses = unrecorded.map((s) => `HTTP ${s}`).join(", ");
      return `not recorded: ${unrecorded.length} response(s) failed (${statuses}), so this case wouldn't replay; its earlier cassettes stay`;
    }
    if (!kept.size && !existsSync(options.dir)) return null;
    mkdirSync(options.dir, { recursive: true });
    // New files first, then prune: a failed write leaves a superset, not nothing.
    for (const [key, stored] of kept)
      writeFileSync(new URL(`${key}.json`, options.dir), `${JSON.stringify(stored, null, 2)}\n`);
    for (const name of readdirSync(options.dir)) {
      if (name.endsWith(".json") && !kept.has(name.slice(0, -".json".length)))
        rmSync(new URL(name, options.dir));
    }
    return null;
  };
  return { fetch, commit };
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
