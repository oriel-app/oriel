// Effects as data, for every page: requests to our own server, tagged with
// what they're for, and the few things that touch the address bar or the
// thread's event stream. `perform` (effects.ts) carries them out; updates
// return them, so they're tested without a DOM.
import type { Route } from "./route.ts";
import type { GroupingId } from "./view.ts";

export type Tag =
  | { kind: "groups" }
  | { kind: "createGroup" }
  | { kind: "addToGroup"; groupId: string }
  | { kind: "group"; id: string }
  | { kind: "groupChanged"; id: string }
  | { kind: "renamed"; id: string }
  | { kind: "threadOpened"; groupId: string }
  | { kind: "thread"; id: string }
  | { kind: "sent"; threadId: string }
  | { kind: "threadAction"; threadId: string }
  | { kind: "diff"; changeSetId: string }
  | { kind: "changeSet"; threadId: string; changeSetId: string }
  | { kind: "reviewLink"; changeSetId: string }
  | { kind: "inbox" }
  | { kind: "reviewOpened" }
  | { kind: "reviewDecided" };

export type Effect =
  | { type: "loadWindow"; request: number; grouping: GroupingId }
  // Puts the grouping in the address bar, so a reload keeps it.
  | { type: "showGrouping"; grouping: GroupingId }
  | { type: "http"; method: "GET" | "POST"; url: string; body?: unknown; tag: Tag }
  // Goes to another page, as a link would, and adds it to history.
  | { type: "navigate"; route: Route }
  // Watches a thread's events after `after`; one thread at a time.
  | { type: "subscribe"; threadId: string; after: number }
  | { type: "unsubscribe" }
  | { type: "copy"; text: string };

// A server's reply to an `http` effect. `body` is our own server's JSON in
// the shape @oriel/web/view declares for that route, or `{ error }`.
export type Replied = { type: "replied"; tag: Tag; ok: boolean; body: unknown };

export const get = (url: string, tag: Tag): Effect => ({ type: "http", method: "GET", url, tag });
export const post = (url: string, body: unknown, tag: Tag): Effect => ({
  type: "http",
  method: "POST",
  url,
  body,
  tag,
});

// What a failed reply says, for the person.
export function errorOf(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  )
    return body.error;
  return "Something went wrong. Try again.";
}
