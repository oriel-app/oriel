// The seam between Slack's Web API and how it is reached. The source only
// calls a `SlackApi`: Slack's MCP server answers its calls
// (`slackServerReads`, decision 0059), and `memoryApi` sends each to a
// fixture's in-memory workspace, for tests, shots and timings, with no
// token. The source's is read methods only, checked at run time too, so a
// cast can't send a write (decision 0021); only `@oriel/slack/writer` hands
// out one that posts.
import { boolean, object, optional, string } from "@oriel/core";

export const readMethods = [
  "auth.test",
  "conversations.history",
  "conversations.info",
  "conversations.list",
  "conversations.replies",
  "users.profile.get",
] as const;
export type ReadMethod = (typeof readMethods)[number];

// One call: its method and its arguments as form fields. Resolves to the
// reply's body when Slack says `ok`, and throws a `SlackError` when it
// doesn't.
export type SlackApi<M extends string = ReadMethod> = (
  method: M,
  params: Record<string, string>,
) => Promise<unknown>;

// What Slack said instead of `ok`, by its error code, such as
// "channel_not_found".
export class SlackError extends Error {
  readonly code: string;
  constructor(method: string, code: string) {
    super(`${method}: ${code}`);
    this.name = "SlackError";
    this.code = code;
  }
}

const envelope = object({ ok: boolean, error: optional(string) });

// A fixture's in-memory workspace, such as `fixtureApi`'s, as Slack's Web
// API answers, for `methods` only, checked at run time: no token goes with
// a call, and `fetch` is the workspace's own, never the network's, so
// nothing reaches Slack through it. Only the writer's entry hands out one
// that can write.
export function memoryApi<M extends string>(
  send: typeof fetch,
  methods: readonly M[],
  side: string,
): SlackApi<M> {
  return async (method, params) => {
    if (!methods.includes(method))
      throw new Error(`refusing a method ${side} doesn't use: ${method}`);
    const response = await send(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams(params),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: a proxy's error page, or an outage.
    }
    const status = envelope(body);
    if (!status.ok) throw new Error(`${method}: ${response.status}, not a Slack reply`);
    if (!status.value.ok) throw new SlackError(method, status.value.error ?? "failed");
    return body;
  };
}
