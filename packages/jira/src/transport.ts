export type JiraRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};
export type JiraResponse = { status: number; body: unknown };
export type Transport = (request: JiraRequest) => Promise<JiraResponse>;

// Jira takes the search only as a POST.
export const searchPath = "/rest/api/3/search/jql";
export type ReadRequest =
  | { method: "GET"; path: string }
  | { method: "POST"; path: typeof searchPath; body: unknown };
export type ReadTransport = (request: ReadRequest) => Promise<JiraResponse>;

export function siteOrigin(site: string): string {
  const url = URL.canParse(site) ? new URL(site) : null;
  if (url?.protocol !== "https:" || url.origin !== site.replace(/\/$/, ""))
    throw new RangeError(
      "the Jira site must be an https origin, like https://example.atlassian.net",
    );
  return url.origin;
}

// `fetch` is the site's own, never the network's, so nothing reaches a real site through it.
export function memoryTransport(site: string, send: typeof fetch): Transport {
  const origin = new URL(siteOrigin(site));
  return async (request) => {
    // "/rest/" keeps a path from naming another host ("//host") or escaping the API.
    if (!request.path.startsWith("/rest/")) throw new RangeError("Jira paths start with /rest/");
    const hasBody = request.body !== undefined;
    const response = await send(new URL(request.path, origin), {
      method: request.method,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
    });
    return { status: response.status, body: parse(await response.text()) };
  };
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

export class JiraFailed extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "JiraFailed";
    this.status = status;
  }
}

export function failure(request: JiraRequest, response: JiraResponse): JiraFailed {
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
  return new JiraFailed(
    `${request.method} ${request.path.split("?")[0]}: ${response.status}${detail ? ` ${detail}` : ""}`,
    response.status,
  );
}
