// Read methods only, checked at run time too, so a cast can't send a write; only
// `@oriel/slack/writer` hands out an api that posts.
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

export type SlackApi<M extends string = ReadMethod> = (
  method: M,
  params: Record<string, string>,
) => Promise<unknown>;

export class SlackError extends Error {
  readonly code: string;
  constructor(method: string, code: string) {
    super(`${method}: ${code}`);
    this.name = "SlackError";
    this.code = code;
  }
}

const envelope = object({ ok: boolean, error: optional(string) });

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
    } catch {}
    const status = envelope(body);
    if (!status.ok) throw new Error(`${method}: ${response.status}, not a Slack reply`);
    if (!status.value.ok) throw new SlackError(method, status.value.error ?? "failed");
    return body;
  };
}
