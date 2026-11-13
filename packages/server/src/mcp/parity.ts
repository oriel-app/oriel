// scripts/check-repo.ts fails on a route none covers and on an entry here no route declares; mcp.test.ts checks every way named here exists.

export type ProgramWay =
  // The door's tools, `oriel://` templates or methods that do what it does,
  // separated by spaces.
  | { door: string }
  // Why a program has no way to do it.
  | { not: string };

const settings = "The person's own settings, which no program may read or change (decision 0041).";
const setup = "The person's own first run, on their machine (decision 0038).";
const undoLater =
  "The person undoes a tool's call in the window; a tool taking back its own comes with the call log (decision 0058).";
const threadsLater = "A tool opens a thread and says what it asks with OA-73 (decision 0058).";
const toolsOwn = "Which programs reach Oriel, and how, is the person's call alone (decision 0058).";
const connecting =
  "Connecting a source is the person's: it holds credentials and decides what Oriel reads (decision 0049).";

export const windowRoutes: Record<string, ProgramWay> = {
  "GET /settings": { not: settings },
  "POST /settings": { not: settings },
  "POST /settings/look": { not: settings },
  "POST /settings/usage": { not: settings },
  "GET /outside-tools": { not: toolsOwn },
  "POST /outside-tools": { not: toolsOwn },
  "POST /outside-tools/:id/revoke": { not: toolsOwn },
  "GET /setup": { not: setup },
  "POST /setup/cli": { not: setup },
  "POST /setup/ai": { not: setup },
  "POST /setup/progress": { not: setup },
  "POST /servers/look": {
    not: "Asking the person's agent for its MCP servers starts their own servers: the person does, with Sync (decision 0059).",
  },
  "POST /connections/:id/pick": { not: connecting },
  "GET /connections/:id/review": { not: connecting },
  "POST /connections/:id/review": { not: connecting },
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
  "GET /change-sets/:id/diff": {
    not: "The window's first draw of a diff, before its sources answer; a program reads the diff itself.",
  },
  "GET /threads/events": { door: "subscriptions/listen" },
  "GET /threads/:id/events": { door: "subscriptions/listen" },
  "POST /^\\/api\\/actions\\/([a-z]+\\.[a-z]+)$/": { not: undoLater },
  "POST /threads": { not: threadsLater },
  "POST /workstreams/:id/threads": { not: threadsLater },
  "POST /window-chat/messages": {
    not: "The window chat is the person's own conversation with the window (decision 0027), and thread_say refuses a tool there; a program opens a thread of its own.",
  },
};
