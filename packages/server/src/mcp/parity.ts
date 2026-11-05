// Parity (OA-75): whatever the window can do, a program connected to Oriel
// can do too, short of what is the person's alone, and it sees whatever the
// window shows. The window reaches the server only through its routes
// (api.ts), so its routes are the measure. Each is covered one of three ways:
// - a read: one of the window's reads in reads.ts serves it as a resource;
// - one action: a POST that dispatches a single action is covered by the
//   registry, which makes it a tool or says why tools may not call it
//   (decision 0024);
// - here: its program's way in, as tools, resources or a method of the
//   door's, or why a program has none.
// scripts/check-repo.ts fails on a route none covers, and on an entry here
// no route declares; mcp.test.ts checks every way named here exists.

export type ProgramWay =
  // The door's tools, `oriel://` templates or methods that do what it does,
  // separated by spaces.
  | { door: string }
  // Why a program has no way to do it.
  | { not: string };

const settings = "The person's own settings, which no program may read or change (decision 0041).";
const setup = "The person's own first run, on their machine (decision 0038).";
const connecting =
  "Connecting a source is the person's: it holds credentials and decides what Oriel reads (decision 0049).";

// By `METHOD /path`, as api.ts declares each route.
export const windowRoutes: Record<string, ProgramWay> = {
  "GET /settings": { not: settings },
  "POST /settings": { not: settings },
  "POST /settings/key": { not: settings },
  "POST /settings/look": { not: settings },
  "POST /settings/usage": { not: settings },
  "GET /setup": { not: setup },
  "POST /setup/cli": { not: setup },
  "POST /setup/ai": { not: setup },
  "POST /setup/progress": { not: setup },
  "POST /connections/pick": { not: connecting },
  "POST /connections/browser": { not: connecting },
  "POST /connections/:id/pick": { not: connecting },
  "GET /connections/:id/review": { not: connecting },
  "POST /connections/:id/review": { not: connecting },
  // The agent drafts a connection's options when the person asks it to; a
  // program asks for the same in a thread, in its own words.
  "POST /connections/:id/draft": { door: "thread_open thread_say" },
  "POST /telemetry": {
    not: "The window's own telemetry: a program's calls are counted as they're made.",
  },
  "POST /review/open": {
    not: "A review link's page, for whoever holds the link, never a connected program (decision 0024).",
  },
  "POST /review/decide": { not: "Approval is a person's (decision 0003)." },
  "GET /threads/:id/deletion": {
    not: "What deleting a thread would lose, which only the person does (decision 0024).",
  },
  "GET /outside": {
    not: "The person's record of every program's calls, to undo any; a program gets each of its own calls back as it makes it.",
  },
  "GET /threads/events": { door: "subscriptions/listen" },
  "GET /threads/:id/events": { door: "subscriptions/listen" },
  // Undo: a program undoes its own calls; the person undoes anyone's.
  "POST /^\\/api\\/actions\\/([a-z]+\\.[a-z]+)$/": { door: "undo" },
  // A thread from nothing, on a workstream of its own with no items: a
  // program makes one of the items it picked, then opens a thread on it.
  "POST /threads": { door: "workstream_create thread_open thread_say" },
  "POST /workstreams/:id/threads": { door: "thread_open thread_say" },
  "POST /window-chat/messages": {
    not: "The window chat is the person's own conversation with the window (decision 0027); a program opens a thread of its own.",
  },
};
