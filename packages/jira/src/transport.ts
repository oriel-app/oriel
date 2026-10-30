// The seam between Jira's REST shapes and how they are fetched. The source only
// ever calls a `ReadTransport`, and the writer a `Transport`. `restTransport`
// sends requests over HTTPS behind a `Credential`; a cassette replays recorded
// ones; an MCP-backed implementation could answer the same requests without
// touching either. Only `@oriel/jira/writer` exports `restTransport`.
import { setTimeout as wait } from "node:timers/promises";
import type { Credential } from "@oriel/core";

export type JiraRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  // From /rest/, query string included.
  path: string;
  body?: unknown;
};
export type JiraResponse = { status: number; body: unknown };
export type Transport = (request: JiraRequest) => Promise<JiraResponse>;

// What the read side sends: GETs, and the search Jira only takes as a POST.
export const searchPath = "/rest/api/3/search/jql";
export type ReadRequest =
  | { method: "GET"; path: string }
  | { method: "POST"; path: typeof searchPath; body: unknown };
export type ReadTransport = (request: ReadRequest) => Promise<JiraResponse>;

// An Atlassian account's email and API token. The token stays in the closure.
export function basicAuth(email: string, token: string): Credential {
  const header = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  return { headers: async () => ({ Authorization: header }) };
}

export type RestOptions = {
  // An https origin, such as "https://oriel.atlassian.net".
  site: string;
  credential: Credential;
  fetch?: typeof fetch;
  // How a retry waits; tests pass one that resolves at once.
  wait?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
};

const maxAttempts = 5;

// A site as an https origin with no trailing slash, or a RangeError.
export function siteOrigin(site: string): string {
  const url = URL.canParse(site) ? new URL(site) : null;
  if (url?.protocol !== "https:" || url.origin !== site.replace(/\/$/, ""))
    throw new RangeError(
      "the Jira site must be an https origin, like https://example.atlassian.net",
    );
  return url.origin;
}

export function restTransport(options: RestOptions): Transport {
  const site = new URL(siteOrigin(options.site));
  const send = options.fetch ?? fetch;
  const pause = options.wait ?? wait;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return async (request) => {
    // "/rest/" keeps a path from naming another host ("//host") or escaping the API.
    if (!request.path.startsWith("/rest/")) throw new RangeError("Jira paths start with /rest/");
    const url = new URL(request.path, site);
    const hasBody = request.body !== undefined;
    for (let attempt = 1; ; attempt++) {
      const response = await send(url, {
        method: request.method,
        headers: {
          ...(await options.credential.headers()),
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A 429 was not processed, so any request may retry it; a 503 might
      // have been, so only reads do.
      const retry =
        response.status === 429 || (response.status === 503 && request.method === "GET");
      if (retry && attempt < maxAttempts) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("Retry-After")) || 5;
        await pause(Math.min(seconds, 60) * 1000);
        continue;
      }
      return { status: response.status, body: parse(await response.text()) };
    }
  };
}

// The read side's transport over HTTPS.
export function readTransport(options: RestOptions): ReadTransport {
  return readOnly(restTransport(options));
}

// Checks the method at run time too, so a cast can't send a write through it.
export function readOnly(inner: Transport): ReadTransport {
  return async (request: JiraRequest) => {
    const search = request.method === "POST" && request.path === searchPath;
    if (request.method !== "GET" && !search)
      throw new Error(`refusing a write on the read side: ${request.method} ${request.path}`);
    return inner(request);
  };
}

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 300);
  }
}

// Jira's own words for a failed request, bounded, for error messages.
export function failure(request: JiraRequest, response: JiraResponse): Error {
  const body = response.body;
  const messages =
    typeof body === "object" && body !== null
      ? [
          ...("errorMessages" in body && Array.isArray(body.errorMessages)
            ? body.errorMessages
            : []),
          ...("errors" in body && typeof body.errors === "object" && body.errors !== null
            ? Object.entries(body.errors).map(([field, message]) => `${field}: ${message}`)
            : []),
        ]
      : [String(body ?? "")];
  const detail = messages.join("; ").slice(0, 300);
  return new Error(
    `${request.method} ${request.path.split("?")[0]}: ${response.status}${detail ? ` ${detail}` : ""}`,
  );
}
