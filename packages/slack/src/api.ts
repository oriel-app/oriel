// The seam between Slack's Web API and how it is reached. The source only
// calls a `SlackApi`: `webApi` sends each call to slack.com behind a
// `Credential`, and the fixture's fake answers the same calls from memory.
// The source's is read methods only, checked at run time too, so a cast
// can't send a write (decision 0021); only `@oriel/slack/writer` hands out one
// that posts.
import { setTimeout as wait } from "node:timers/promises";
import { boolean, type Credential, object, optional, string } from "@oriel/core";

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

// A Slack token, such as a user token. It stays in the closure.
export function bearer(token: string): Credential {
  const header = `Bearer ${token}`;
  return { headers: async () => ({ Authorization: header }) };
}

export type WebApiOptions = {
  credential: Credential;
  fetch?: typeof fetch;
  // How a retry waits; tests pass one that resolves at once.
  wait?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
};

const maxAttempts = 5;
const envelope = object({ ok: boolean, error: optional(string) });

export function webApi(options: WebApiOptions): SlackApi {
  return methodsApi(options, readMethods, "the read side");
}

// Slack's Web API for `methods` only, checked at run time. The read side's
// is `webApi`; only the writer's entry hands out one that can write.
export function methodsApi<M extends string>(
  options: WebApiOptions,
  methods: readonly M[],
  side: string,
): SlackApi<M> {
  const send = options.fetch ?? fetch;
  const pause = options.wait ?? wait;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return async (method, params) => {
    if (!methods.includes(method))
      throw new Error(`refusing a method ${side} doesn't use: ${method}`);
    for (let attempt = 1; ; attempt++) {
      // The credential's own message stays out of the error, in case it names
      // a secret.
      const credentials = await options.credential.headers().catch((error: unknown) => {
        throw new Error("Oriel couldn't get its credentials for Slack", { cause: error });
      });
      const response = await send(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: { ...credentials, Accept: "application/json" },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 429 && attempt < maxAttempts) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("Retry-After")) || 5;
        await pause(Math.min(seconds, 60) * 1000);
        continue;
      }
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
    }
  };
}
