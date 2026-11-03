// The JSON routes. Every route is behind the Host/Origin guard (site.ts),
// which also refuses a request that changes state unless it carries this
// server's own Origin. On top of that, a POST must send JSON, within its
// route's size cap. GETs read; nothing a GET does opens, decides or writes.
import {
  type Actor,
  type Call,
  array,
  type ChangeSet,
  type ChangeSets,
  type Conflict,
  type IndexRecord,
  type Instant,
  type ItemId,
  isInverse,
  isOverviewSection,
  isItemId,
  isUlid,
  type Log,
  literal,
  maxItems,
  messageText,
  maxNameChars,
  nullable,
  number,
  object,
  type OrielReads,
  optional,
  parseItemId,
  refine,
  string,
  type TelemetryEvent,
  type Ulid,
  union,
  unknown,
  type Validator,
  startQuestions,
} from "@oriel/core";
import type { WorkstreamStore, Message, ThreadStore } from "@oriel/db";
import { sources } from "@oriel/sources";
import {
  type DeletedView,
  type DeletionView,
  browseFilter,
  type BrowseFilter,
  type ClusterPageView,
  type FolderView,
  type SourceView,
  type GroupingId,
  type Undoable,
  type WorkstreamSummary,
  type WorkstreamDeletedView,
  type WorkstreamEndedView,
  isGroupingId,
  type JiraProjectView,
  type JiraView,
  type OverviewView,
  type SearchView,
  type StreamEvent,
  type ThreadsView,
  type WindowView,
} from "@oriel/web/view";
import {
  ActionError,
  checked,
  type Dispatch,
  type Fields,
  isChangeSetError,
  liveChangeSet,
} from "./actions.ts";
import type { LinePlace } from "./intents.ts";
import { resolveDropped } from "./dropped.ts";
import { type SettingsService, SettingsRefused, settingsChange } from "./settings.ts";
import { type Setup, SetupRefused } from "./setup/setup.ts";
import type { ItemPanels } from "./panel.ts";
import type { Reply, Request } from "./site.ts";
import { channel } from "./stream.ts";
import { NothingHeld, ThreadBusy, ThreadLimit, type Turns } from "./turns.ts";
import { changeSetView, type Views } from "./views.ts";

export type ApiDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records(): readonly IndexRecord[];
  // Oriel's own actions, through the one dispatcher (decision 0024).
  dispatch: Dispatch;
  // The user's Undo of a line under the agent's reply, or their redo of it.
  undoLine(at: LinePlace, call: Call, actor: Actor): Promise<{ undo: Call | null }>;
  changeSets: ChangeSets;
  turns: Turns;
  views: Views;
  // Oriel's own threads and change sets, and the one search over them.
  reads: OrielReads;
  // One item for the panel beside the page, read live, and when the index
  // last saw it change.
  items: ItemPanels;
  emit(event: TelemetryEvent): void;
  now(): Instant;
  // Syncs the sources that change outside Oriel, once, so a dropped link to
  // an item made since the last sync can be found. What went wrong, in plain
  // words, or null.
  refresh(): Promise<string | null>;
  // Revert conflicts in plain words.
  explain(conflicts: readonly Conflict[]): string;
  // Browse: a grouping's clusters as rows, with no items, and one page of a
  // cluster's items, or null when the grouping has no such cluster now.
  browse: {
    rows(grouping: GroupingId, filter: BrowseFilter): WindowView;
    page(
      grouping: GroupingId,
      cluster: string,
      from: number,
      filter: BrowseFilter,
    ): ClusterPageView | null;
  };
  // The overview, as the page and the window chat's `window.overview()`
  // read it (decision 0027).
  overview(): Promise<OverviewView>;
  // The connected folder and Jira as they stand, and every connected source
  // as the sidebar lists them; connecting and syncing any is an action.
  folder(): FolderView | null;
  // The system's folder picker, on the desktop app only.
  pickFolder?: (prompt: string) => Promise<string | null>;
  jira(): JiraView;
  // The projects the Jira details typed can see, before any is connected.
  jiraProjects(typed: {
    site: string;
    email: string;
    token: string;
    query: string;
  }): Promise<
    | { projects: JiraProjectView[]; more: boolean }
    | { problem: string; fields: ("site" | "email" | "token")[] }
  >;
  sources(): SourceView[];
  settings: SettingsService;
  // The desktop app's first run and its commands for the person's CLI.
  setup: Setup;
  log: Log;
};

// Body caps, in bytes.
const smallBody = 4 * 1024;
const listBody = 64 * 1024;
const messageBody = 32 * 1024;

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const problem = (status: number, error: string): Reply => json(status, { error });

// A path segment as it was before the browser encoded it; "" if it can't be.
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ulidValue = refine(string, isUlid, "expected an ID");
const itemIdValue = refine(string, isItemId, "expected an item ID");
const nameValue = refine(
  string,
  (name) => name.trim() !== "" && [...name].length <= maxNameChars,
  `expected a name of 1 to ${maxNameChars} characters`,
);
const textValue = messageText;
const maxDropped = 50;
// A search reads this much of its query, and finds this many at most.
const maxQueryChars = 200;
const searchLimit = 20;
const droppedFile = object({
  name: refine(string, (name) => name.length <= 255, "expected at most 255 characters"),
  modified: number,
});
const itemsBody = object({ items: unknown });
const droppedBody = object({
  links: refine(
    array(refine(string, (link) => link.length <= 2048, "expected at most 2048 characters")),
    (list) => list.length <= maxDropped,
    `expected at most ${maxDropped}`,
  ),
  files: refine(
    array(droppedFile),
    (list) => list.length <= maxDropped,
    `expected at most ${maxDropped}`,
  ),
});
const openThreadBody = object({ text: optional(textValue) });
const messageBodyValue = object({ text: textValue });
const tokenBody = object({ token: string });
// A reason goes with a rejection only. How long a holder's may be is the
// dispatcher's to check.
const reviewDecision = refine(
  object({
    token: string,
    changeSet: ulidValue,
    kind: union(literal("approved"), literal("rejected")),
    name: nameValue,
    hash: string,
    reason: optional(string),
  }),
  (body) => body.kind === "rejected" || body.reason === undefined,
  "only a rejection takes a reason",
);
const reviewDismissal = object({
  token: string,
  changeSet: ulidValue,
  name: nameValue,
  hash: string,
});
const emptyBody = object({});
const setupCommand = object({
  command: union(
    literal("check"),
    literal("install"),
    literal("sign-in"),
    literal("update"),
    literal("cancel"),
  ),
});
const setupAi = object({
  ai: union(literal("claude-code"), literal("api")),
  anyway: optional(literal(true)),
});
const setupProgress = object({
  did: union(
    literal("opened"),
    literal("skipped-ai"),
    literal("work"),
    literal("skipped-work"),
    literal("finished"),
    literal("dismissed"),
  ),
});
const typedText = (max: number) => refine(string, (text) => text.length <= max, `at most ${max}`);
const jiraDetails = object({
  site: typedText(300),
  email: typedText(300),
  token: typedText(4096),
  query: optional(typedText(100)),
});
// The window makes a workstream from a cluster or from picked items; a workstream from
// nothing comes only with its thread.
const windowWorkstream = refine(
  unknown,
  (body) =>
    typeof body === "object" &&
    body !== null &&
    "kind" in body &&
    (body.kind === "cluster" || body.kind === "picked"),
  "expected a cluster or picked items",
);
const tinyBody = 256;
const count = refine(number, (n) => Number.isSafeInteger(n) && n >= 0, "expected a count");
const zoomId = union(literal("cluster"), literal("list"), literal("item"));
const windowEvent = union(
  object({
    name: literal("grouping.switched"),
    grouping: refine(string, isGroupingId, "expected epic, assignee, stuck or linked"),
  }),
  object({ name: literal("zoom.changed"), from: zoomId, to: zoomId }),
  // By the item, whose source the event keeps; the item itself isn't kept.
  object({ name: literal("item.panel-opened"), item: itemIdValue }),
  object({
    name: literal("item.source-opened"),
    item: itemIdValue,
    via: union(literal("panel"), literal("link")),
  }),
  // How long the query was, never what it said.
  object({ name: literal("threads.searched"), queryLength: count, results: count }),
  object({ name: literal("items.searched"), queryLength: count, results: count }),
  object({
    name: literal("threads.search-opened"),
    opened: union(literal("thread"), literal("change-set")),
    rank: count,
  }),
  object({ name: literal("overview.opened") }),
  // Make a workstream on a cluster the overview suggested.
  object({
    name: literal("overview.suggestion-made"),
    workstreamId: refine(string, isUlid, "expected a workstream ID"),
    grouping: refine(string, isGroupingId, "expected epic, assignee, stuck or linked"),
  }),
  object({
    name: literal("overview.more-opened"),
    section: refine(string, isOverviewSection, "expected one of the overview's sections"),
  }),
  object({
    name: literal("window-chat.question-used"),
    question: union(...startQuestions.map((question) => literal(question))),
  }),
  // The first run's Show details, copied for someone helping the person.
  object({
    name: literal("first-run.details-copied"),
    what: union(
      literal("install"),
      literal("sign-in"),
      literal("update"),
      literal("test"),
      literal("jira"),
    ),
  }),
);

async function readJson<T>(request: Request, limit: number, validator: Validator<T>): Promise<T> {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new Refused(415, "send JSON");
  const text = request.body ? await request.body(limit) : "";
  if (text === null) throw new Refused(413, `the body is over ${limit} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Refused(400, "the body isn't JSON");
  }
  const result = validator(parsed);
  if (!result.ok)
    throw new Refused(400, result.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return result.value;
}

// An action's refusal as an HTTP status.
const actionStatus = { invalid: 400, refused: 403, "not-found": 404, conflict: 409 } as const;

// The window's door is the user's.
const user: Actor = { kind: "user" };

// The line under the agent's reply an Undo names, as `?thread=…&seq=…&line=…`,
// or null for an Undo from anywhere else.
function linePlace(params: URLSearchParams): LinePlace | null {
  const [thread, seq, index] = [params.get("thread"), params.get("seq"), params.get("line")];
  if (thread === null && seq === null && index === null) return null;
  const at = { thread: thread ?? "", seq: Number(seq ?? NaN), index: Number(index ?? NaN) };
  if (!isUlid(at.thread) || !Number.isSafeInteger(at.seq) || at.seq < 1)
    throw new Refused(400, "expected the line's thread and the seq of its list");
  if (!Number.isSafeInteger(at.index) || at.index < 0)
    throw new Refused(400, "expected the line's place in its list");
  return { ...at, thread: at.thread };
}

// The grouping a Browse request names.
function groupingOf(params: URLSearchParams): GroupingId {
  const grouping = params.get("grouping");
  if (!isGroupingId(grouping))
    throw new Refused(400, "grouping must be epic, assignee, stuck or linked");
  return grouping;
}

// Browse's filters from a request, a query cut as the threads' search cuts
// it. A source or an assignee the index doesn't have keeps nothing, so an
// old address shows that, rather than failing.
function filterOf(params: URLSearchParams): BrowseFilter {
  const filter = browseFilter(params);
  if (params.get("status")?.trim() && !filter.status)
    throw new Refused(400, "status must be todo, in-progress or done");
  return filter.q ? { ...filter, q: filter.q.slice(0, maxQueryChars) } : filter;
}

// A count of items from a request: a whole number, 0 when absent.
function fromOf(params: URLSearchParams): number {
  const from = Number(params.get("from") ?? 0);
  if (!Number.isSafeInteger(from) || from < 0)
    throw new Refused(400, "from must be a whole number, from 0");
  return from;
}

// A change-set refusal (`ChangeSetError`, by its name and code) as an HTTP
// status; null for any other error.
function changeSetStatus(error: unknown): number | null {
  if (!isChangeSetError(error)) return null;
  return error.code === "not-found" ? 404 : error.code === "invalid" ? 400 : 409;
}

type Route = {
  method: "GET" | "POST";
  path: RegExp;
  run(params: string[], request: Request, url: URL): Promise<Reply>;
};

const ulidPart = "([0-9A-HJKMNP-TV-Z]{26})";
// An item ID, as one path segment (`jira%3ASYN-12`).
const itemPart = "([^/]{1,512})";
// A chat entry's place in its thread.
const seqPart = "([1-9][0-9]{0,8})";
// Workstreams were called groups until OA-98: /api/groups/… still answers as
// /api/workstreams/…, for a tab opened before then.
const at = (path: string) =>
  new RegExp(
    `^/api${path.replaceAll(":id", ulidPart).replaceAll(":item", itemPart).replaceAll(":seq", seqPart)}$`,
  );

export function api(deps: ApiDeps): (request: Request, url: URL) => Promise<Reply | null> {
  const { workstreams, threads, changeSets, turns, views } = deps;

  const mustWorkstream = (id: string) => {
    const workstream = workstreams.get(id as Ulid);
    if (!workstream || workstream.workspaceId !== deps.workspaceId)
      throw new Refused(404, "no such workstream");
    return workstream;
  };
  const mustThread = (id: string) => {
    const thread = threads.get(id as Ulid, deps.now());
    if (!thread || thread.workspaceId !== deps.workspaceId)
      throw new Refused(404, "no such thread");
    return thread;
  };
  // A workstream marked done or reopened, and how many threads came along.
  const ended = async (
    id: string,
    carried: number,
    undo: Call | null,
  ): Promise<Undoable<WorkstreamEndedView> | null> => {
    const view = await views.workstream(id as Ulid);
    return view && { ...view, carried, undo };
  };
  const mustChangeSet = async (id: string) => {
    const set = await liveChangeSet(deps, id as Ulid);
    if (!set) throw new Refused(404, "no such change set");
    return set;
  };

  // An item ID from a request, with its source.
  const mustItem = (text: string) => {
    const parsed = parseItemId(text);
    if (!parsed) throw new Refused(400, "expected an item ID");
    return { id: text as ItemId, source: parsed.source };
  };

  // A change set as the window shows it, with what can be done with it, as
  // the change set engine says.
  const viewOf = async (set: ChangeSet) =>
    changeSetView(
      set,
      await changeSets.ofThread(set.threadId),
      await changeSets.nextSteps(set.id),
      changeSets.applying(set.id),
      changeSets.writable(set.id),
      changeSets.stalled(set.id),
    );
  const changeSetReply = async (id: Ulid, extra: Record<string, unknown> = {}) =>
    json(200, { changeSet: await viewOf(await mustChangeSet(id)), ...extra });
  const threadView = async (threadId: Ulid) => {
    const sets = await changeSets.ofThread(threadId);
    const steps = new Map(
      await Promise.all(
        sets.map(async (set) => [set.id, await changeSets.nextSteps(set.id)] as const),
      ),
    );
    return views.thread(
      threadId,
      sets,
      steps,
      (id) => changeSets.applying(id as Ulid),
      (id) => changeSets.stalled(id as Ulid),
      (id) => changeSets.writable(id as Ulid),
    );
  };

  const stream = (threadId: Ulid, after: number): Reply => {
    let last = after;
    const out = channel<string>(() => stop());
    const send = (event: StreamEvent, seq?: number) =>
      out.push(`${seq === undefined ? "" : `id: ${seq}\n`}data: ${JSON.stringify(event)}\n\n`);
    const status = () => {
      const thread = threads.get(threadId, deps.now());
      if (!thread) return;
      send({
        type: "status",
        running: turns.running(threadId),
        state: thread.state,
        regionVersion: thread.regionVersion,
        title: views.title(threadId),
      });
    };
    const entry = (message: Message) => {
      if (message.seq <= last) return;
      last = message.seq;
      const shown = views.entry(message, threadId);
      if (shown) send({ type: "entry", entry: shown }, message.seq);
    };
    // Watch first, then catch up, in one synchronous step, so no entry falls
    // between the two.
    // A deleted thread says so, last.
    const unwatch = turns.watch(threadId, (event) => {
      if (event.type === "message") entry(event.message);
      else if (event.type === "change-set")
        send({ type: "change-set", changeSetId: event.changeSetId, applying: event.applying });
      else if (event.type === "workstream") send({ type: "workstream" });
      else if (event.type === "chat") send({ type: "chat" });
      else if (event.type === "deleted") {
        send({ type: "deleted" });
        out.end();
      } else status();
    });
    // A thread's page hears the rest of the workspace change on this stream
    // too, so a tab holds one stream at most: browsers allow few per host.
    // Its own thread's moves are the status and change-set events above.
    const unwatchAny = turns.watchAny((moved) => {
      if (moved !== threadId) send({ type: "threads" });
    });
    const stop = () => {
      unwatch();
      unwatchAny();
    };
    out.push("retry: 2000\n\n");
    for (const message of threads.messages(threadId, after)) entry(message);
    status();
    return {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" },
      body: "",
      stream: out.iterator,
    };
  };

  // The workspace changed: a thread moved, or one of Oriel's own actions
  // changed something, whoever called it. One empty event each time, which
  // pages answer by loading again what they show.
  const anyStream = (): Reply => {
    const out = channel<string>(() => stop());
    const stop = turns.watchAny(() => out.push('data: {"type":"threads"}\n\n'));
    out.push("retry: 2000\n\n");
    return {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" },
      body: "",
      stream: out.iterator,
    };
  };

  const routes: Route[] = [
    {
      // Settings (OA-181): the person's providers, models and look. No
      // reply carries a key, only whether one is set.
      method: "GET",
      path: at("/settings"),
      run: async () => json(200, deps.settings.view()),
    },
    {
      // One change, applied at once.
      method: "POST",
      path: at("/settings"),
      async run(_, request) {
        const change = await readJson(request, smallBody, settingsChange);
        try {
          return json(200, await deps.settings.change(change));
        } catch (error) {
          if (error instanceof SettingsRefused) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      // An API key for the desktop app's secret store, or null to remove
      // it. The reply says only whether one is set.
      method: "POST",
      path: at("/settings/key"),
      async run(_, request) {
        const { key } = await readJson(request, smallBody, object({ key: nullable(string) }));
        try {
          return json(200, await deps.settings.key(key));
        } catch (error) {
          if (error instanceof SettingsRefused) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      // Check again: looks for every provider, as at startup.
      method: "POST",
      path: at("/settings/look"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        return json(200, await deps.settings.look());
      },
    },
    {
      // The desktop app's setup, and the Claude Code row it shares with
      // Settings (decision 0038). Under `pnpm dev`, all null.
      method: "GET",
      path: at("/setup"),
      run: async () => json(200, await deps.setup.view()),
    },
    {
      // A command for the person's Claude Code, from a fixed list. One that
      // runs on, as an install does, answers at once; the page asks again.
      method: "POST",
      path: at("/setup/cli"),
      async run(_, request) {
        const { command } = await readJson(request, smallBody, setupCommand);
        try {
          return json(200, await deps.setup.command(command));
        } catch (error) {
          if (error instanceof SetupRefused) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      // The AI the first run continues with: Claude Code once its test turn
      // answers, or the API key Settings kept.
      method: "POST",
      path: at("/setup/ai"),
      async run(_, request) {
        const { ai, anyway } = await readJson(request, smallBody, setupAi);
        try {
          return json(200, await deps.setup.choose(ai, anyway === true));
        } catch (error) {
          if (error instanceof SetupRefused || error instanceof SettingsRefused)
            throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      // The first run's own steps, each done or skipped, its end, and the
      // overview's one-time line dismissed.
      method: "POST",
      path: at("/setup/progress"),
      async run(_, request) {
        const { did } = await readJson(request, smallBody, setupProgress);
        try {
          return json(200, await deps.setup.progress(did));
        } catch (error) {
          if (error instanceof SetupRefused) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      method: "GET",
      path: at("/folder"),
      run: async () => json(200, { folder: deps.folder(), picker: deps.pickFolder !== undefined }),
    },
    {
      // On the desktop app, the system's folder picker, through the shell,
      // then the folder picked is connected as a typed one is. Cancelling
      // changes nothing.
      method: "POST",
      path: at("/folder/pick"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        if (!deps.pickFolder)
          throw new Refused(409, "Type the folder's path: there's no picker here.");
        let picked: string | null;
        try {
          picked = await deps.pickFolder("Choose a folder of markdown files for Oriel to read.");
        } catch {
          throw new Refused(409, "The folder picker didn't open. Try again.");
        }
        if (picked === null) return json(200, { folder: deps.folder(), picked: false });
        const input = checked("source.connect", { kind: "folder", path: picked });
        const connected = await deps.dispatch("source.connect", input, user);
        if ("problem" in connected) throw new Refused(400, connected.problem);
        return json(200, { ...connected, picked: true });
      },
    },
    {
      // Connects the folder whose path the user typed, under `pnpm dev`,
      // which has no picker. Only a directory is taken; its items sync into
      // the index at once.
      method: "POST",
      path: at("/folder"),
      async run(_, request) {
        const { path } = await readJson(request, smallBody, object({ path: unknown }));
        const input = checked("source.connect", { kind: "folder", path });
        const connected = await deps.dispatch("source.connect", input, user);
        if ("problem" in connected) throw new Refused(400, connected.problem);
        return json(200, connected);
      },
    },
    {
      method: "POST",
      path: at("/folder/sync"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        const synced = await deps.dispatch("source.sync", { source: "folder" }, user);
        if ("problem" in synced) throw new Refused(409, synced.problem);
        return json(200, synced);
      },
    },
    {
      method: "GET",
      path: at("/sources"),
      run: async () => json(200, { sources: deps.sources() }),
    },
    {
      // A full sweep of Slack's picked channels. Slack failing it is a 502.
      method: "POST",
      path: at("/slack/sync"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        const synced = await deps.dispatch("source.sync", { source: "slack" }, user);
        if ("problem" in synced) throw new Refused(502, synced.problem);
        return json(200, synced);
      },
    },
    {
      // Browse's first reply: the clusters, with no items (decision 0027).
      method: "GET",
      path: at("/browse"),
      run: async (_, _request, url) =>
        json(200, deps.browse.rows(groupingOf(url.searchParams), filterOf(url.searchParams))),
    },
    {
      // A page of one cluster's items, as the user opens it or asks for more.
      method: "GET",
      path: at("/browse/items"),
      async run(_, _request, url) {
        const { searchParams } = url;
        const page = deps.browse.page(
          groupingOf(searchParams),
          searchParams.get("cluster") ?? "",
          fromOf(searchParams),
          filterOf(searchParams),
        );
        if (!page) throw new Refused(404, "no such cluster");
        return json(200, page);
      },
    },
    {
      method: "GET",
      path: at("/jira"),
      run: async () => json(200, { jira: deps.jira() }),
    },
    {
      // The projects the details typed can see, so the person picks one from
      // Jira's own list. A read: nothing is kept, and the token is never sent
      // back. A refusal names the fields it's about.
      method: "POST",
      path: at("/jira/projects"),
      async run(_, request) {
        const typed = await readJson(request, smallBody, jiraDetails);
        const listed = await deps.jiraProjects({ ...typed, query: typed.query ?? "" });
        return "problem" in listed
          ? json(400, { error: listed.problem, fields: listed.fields })
          : json(200, listed);
      },
    },
    {
      // Connects Jira with the details the user typed. They're checked
      // against the site before anything is kept, and its items sync into
      // the index at once. The token is never sent back.
      method: "POST",
      path: at("/jira"),
      async run(_, request) {
        const typed = await readJson(
          request,
          smallBody,
          object({ site: unknown, email: unknown, token: unknown, project: unknown }),
        );
        const input = checked("source.connect", { kind: "jira", ...typed });
        const connected = await deps.dispatch("source.connect", input, user);
        if ("problem" in connected) throw new Refused(400, connected.problem);
        return json(200, connected);
      },
    },
    {
      // A full sweep of Jira, so what was made or deleted there since the
      // last sync shows. Jira failing it is a 502: the request was fine.
      method: "POST",
      path: at("/jira/sync"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        const synced = await deps.dispatch("source.sync", { source: "jira" }, user);
        if ("problem" in synced) throw new Refused(502, synced.problem);
        return json(200, synced);
      },
    },
    {
      // The overview, computed now (decision 0027).
      method: "GET",
      path: at("/overview"),
      async run() {
        return json(200, await deps.overview());
      },
    },
    {
      // The user left the overview: what it showed is seen (decision 0027).
      // `seq` is the last change log entry the page counted, so one that
      // committed after it rendered stays unseen. The overview calls this as
      // the user leaves it.
      method: "POST",
      path: at("/overview/leave"),
      async run(_, request) {
        const typed = await readJson(request, tinyBody, object({ seq: unknown }));
        const input = checked("overview.leave", typed);
        const { seenAt } = await deps.dispatch("overview.leave", input, user);
        return json(200, { seenAt });
      },
    },
    {
      // What only the window knows happened. Ten events, fixed fields.
      method: "POST",
      path: at("/telemetry"),
      async run(_, request) {
        const event = await readJson(request, tinyBody, windowEvent);
        const at = deps.now();
        const { workspaceId } = deps;
        const sourceOf = (id: string) => mustItem(id).source;
        deps.emit(
          event.name === "grouping.switched"
            ? { name: event.name, at, workspaceId, grouping: event.grouping }
            : event.name === "zoom.changed"
              ? { name: event.name, at, workspaceId, from: event.from, to: event.to }
              : event.name === "item.panel-opened"
                ? { name: event.name, at, workspaceId, source: sourceOf(event.item) }
                : event.name === "item.source-opened"
                  ? {
                      name: event.name,
                      at,
                      workspaceId,
                      source: sourceOf(event.item),
                      via: event.via,
                    }
                  : { ...event, at, workspaceId },
        );
        return json(202, {});
      },
    },
    {
      // The sidebar's search over the workspace's threads and what their
      // change sets wrote: the one search the agent's thread.find() runs.
      method: "GET",
      path: at("/search"),
      async run(_, _request, url) {
        const query = (url.searchParams.get("q") ?? "").slice(0, maxQueryChars);
        const found = await deps.reads.find(query, searchLimit);
        return json(200, {
          query,
          results: found.map((hit) => ({
            thread: {
              id: hit.thread.id,
              title: hit.thread.name,
              state: hit.thread.state,
              workstream: hit.thread.workstream,
            },
            changeSet: hit.changeSet && { id: hit.changeSet.id, state: hit.changeSet.state },
            matched: hit.matched,
            excerpt: hit.excerpt,
          })),
        } satisfies SearchView);
      },
    },
    {
      // An item for the panel beside the page, read live. A source that
      // doesn't answer is a plain sentence; a missing item is a view.
      method: "GET",
      path: at("/items/:item"),
      async run([item = ""]) {
        const { id, source } = mustItem(decoded(item));
        try {
          return json(200, await deps.items.read(id));
        } catch (error) {
          deps.log("api: item read failed", { source, error: String(error) });
          throw new Refused(
            502,
            `${sources[source].name} didn't answer, so Oriel couldn't read this item. Try again.`,
          );
        }
      },
    },
    {
      method: "GET",
      path: at("/items/:item/stamp"),
      async run([item = ""]) {
        return json(200, deps.items.stamp(mustItem(decoded(item)).id));
      },
    },
    {
      // An Undo: the call the server gave for one of Oriel's own actions,
      // sent back as it is, so only an action that undoes another. The reply
      // is that call's own undo. One from a line under the agent's reply
      // names the line, which then says what came of it.
      method: "POST",
      path: /^\/api\/actions\/([a-z]+\.[a-z]+)$/,
      async run([name = ""], request, url) {
        if (!isInverse(name)) throw new Refused(404, "no such undo");
        const input = await readJson(request, listBody, unknown);
        const at = linePlace(url.searchParams);
        const { undo } = at
          ? await deps.undoLine(at, { action: name, input } as Call, user)
          : await deps.dispatch.untyped(name, input, user);
        return json(200, { undo });
      },
    },
    {
      method: "GET",
      path: at("/workstreams"),
      run: async () => json(200, { workstreams: views.workstreams(deps.workspaceId) }),
    },
    {
      method: "POST",
      path: at("/workstreams"),
      async run(_, request) {
        const body = await readJson(request, listBody, windowWorkstream);
        const { workstream, undo } = await deps.dispatch(
          "workstream.create",
          checked("workstream.create", body as Fields<"workstream.create">),
          user,
        );
        const made: Undoable<WorkstreamSummary> = { ...views.workstreamSummary(workstream), undo };
        return json(201, made);
      },
    },
    {
      method: "GET",
      path: at("/workstreams/:id"),
      async run([id = ""]) {
        mustWorkstream(id);
        return json(200, await views.workstream(id as Ulid));
      },
    },
    {
      method: "POST",
      path: at("/workstreams/:id/add"),
      async run([id = ""], request) {
        const { items } = await readJson(request, listBody, itemsBody);
        const input = checked("workstream.add", { workstream: id, items });
        const { undo } = await deps.dispatch("workstream.add", input, user);
        return json(200, { ...(await views.workstream(id as Ulid)), undo });
      },
    },
    {
      // What the user dropped on the workstream or one of its threads: links, text
      // and file names, as dropped.ts reads them. What names nothing in the
      // index is retried once after a sync, then refused in plain words; the
      // rest is added as the user picking it would be.
      method: "POST",
      path: at("/workstreams/:id/drop"),
      async run([id = ""], request) {
        const workstream = mustWorkstream(id);
        const dropped = await readJson(request, listBody, droppedBody);
        let resolved = resolveDropped(deps.records(), dropped, sources);
        let synced: string | null = null;
        if (resolved.refused.some((refusal) => refusal.syncMightHelp)) {
          synced = await deps.refresh();
          resolved = resolveDropped(deps.records(), dropped, sources);
        }
        if (resolved.ids.length > maxItems)
          throw new Refused(400, `expected at most ${maxItems} items`);
        const { added, undo } = resolved.ids.length
          ? await deps.dispatch(
              "workstream.add",
              { workstream: workstream.id, items: resolved.ids },
              user,
            )
          : { added: [], undo: null };
        const refused = resolved.refused.map(({ what, why, syncMightHelp }) => ({
          what,
          why: synced && syncMightHelp ? `${why} ${synced}` : why,
        }));
        return json(200, {
          workstream: await views.workstream(workstream.id),
          added,
          refused,
          undo,
        });
      },
    },
    {
      method: "POST",
      path: at("/workstreams/:id/remove"),
      async run([id = ""], request) {
        const { items } = await readJson(request, listBody, itemsBody);
        const input = checked("workstream.remove", { workstream: id, items });
        const { undo } = await deps.dispatch("workstream.remove", input, user);
        return json(200, { ...(await views.workstream(id as Ulid)), undo });
      },
    },
    {
      method: "POST",
      path: at("/workstreams/:id/rename"),
      async run([id = ""], request) {
        const { name } = await readJson(request, smallBody, object({ name: unknown }));
        const input = checked("workstream.rename", { workstream: id, name });
        const { undo } = await deps.dispatch("workstream.rename", input, user);
        return json(200, { ...views.workstreamSummary(id as Ulid), undo });
      },
    },
    {
      // Marks the workstream done, with its open threads, or reopens it, with
      // those (decision 0028).
      method: "POST",
      path: at("/workstreams/:id/done"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("workstream.done", { workstream: id });
        const { undo, threads: marked } = await deps.dispatch("workstream.done", input, user);
        return json(200, await ended(id, marked.length, undo));
      },
    },
    {
      method: "POST",
      path: at("/workstreams/:id/reopen"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("workstream.reopen", { workstream: id });
        const { undo, threads: reopened } = await deps.dispatch("workstream.reopen", input, user);
        return json(200, await ended(id, reopened.length, undo));
      },
    },
    {
      // `threads`: how many threads the user was told go with it.
      method: "POST",
      path: at("/workstreams/:id/delete"),
      async run([id = ""], request) {
        const body = await readJson(request, smallBody, object({ threads: unknown }));
        const input = checked("workstream.delete", { workstream: id, threads: body.threads });
        const { undo, threads: gone } = await deps.dispatch("workstream.delete", input, user);
        const deleted = { threads: gone.length, undo };
        return json(200, deleted satisfies Undoable<WorkstreamDeletedView>);
      },
    },
    {
      method: "POST",
      path: at("/workstreams/:id/threads"),
      async run([id = ""], request) {
        const { text } = await readJson(request, messageBody, openThreadBody);
        const opened = checked("thread.open", { workstream: id });
        const { thread } = await deps.dispatch("thread.open", opened, user);
        if (text !== undefined) await deps.dispatch("thread.say", { thread, text }, user);
        return json(201, { id: thread });
      },
    },
    {
      method: "GET",
      path: at("/threads"),
      run: async () =>
        json(200, { threads: await views.threads(deps.workspaceId) } satisfies ThreadsView),
    },
    {
      // A thread from nothing, with its first message: on a new workstream with no
      // items, where the agent may only create them, as when a plan starts
      // with its epic. Until that message is sent, the thread is only a draft
      // in the browser, so one abandoned leaves nothing behind.
      method: "POST",
      path: at("/threads"),
      async run(_, request) {
        const { text } = await readJson(request, messageBody, messageBodyValue);
        const { workstream } = await deps.dispatch("workstream.create", { kind: "thread" }, user);
        const { thread } = await deps.dispatch("thread.open", { workstream }, user);
        await deps.dispatch("thread.say", { thread, text }, user);
        return json(201, { id: thread, workstreamId: workstream });
      },
    },
    {
      // The window chat the window shows (decision 0027): the newest one the
      // user hasn't left with New chat, while it is working; else none, and
      // the next question makes one.
      method: "GET",
      path: at("/window-chat"),
      run: async () =>
        json(200, { thread: deps.threads.windowChat(deps.workspaceId, deps.now())?.id ?? null }),
    },
    {
      // A question in the window chat. The first makes its thread, on an
      // empty workstream of its own, which shows in the sidebar from then on;
      // opening the overview makes nothing.
      method: "POST",
      path: at("/window-chat/messages"),
      async run(_, request) {
        const { text } = await readJson(request, messageBody, messageBodyValue);
        const open = deps.threads.windowChat(deps.workspaceId, deps.now());
        if (open) {
          const { seq } = await deps.dispatch("thread.say", { thread: open.id, text }, user);
          return json(202, { id: open.id, seq });
        }
        const { workstream } = await deps.dispatch("workstream.create", { kind: "window" }, user);
        const { thread } = await deps.dispatch("thread.open", { workstream }, user);
        deps.emit({
          name: "window-chat.opened",
          at: deps.now(),
          workspaceId: deps.workspaceId,
          threadId: thread,
        });
        const { seq } = await deps.dispatch("thread.say", { thread, text }, user);
        return json(201, { id: thread, seq });
      },
    },
    {
      // New chat: the window chat starts afresh with the next question.
      method: "POST",
      path: at("/window-chat/new"),
      async run(_, request) {
        await readJson(request, tinyBody, emptyBody);
        const { left } = await deps.dispatch("window.new-chat", {}, user);
        return json(200, { left });
      },
    },
    {
      method: "GET",
      path: at("/threads/events"),
      run: async () => anyStream(),
    },
    {
      method: "GET",
      path: at("/threads/:id"),
      async run([id = ""]) {
        const thread = mustThread(id);
        return json(200, await threadView(thread.id));
      },
    },
    {
      method: "GET",
      path: at("/threads/:id/events"),
      async run([id = ""], request, url) {
        const thread = mustThread(id);
        const header = request.headers["last-event-id"];
        const resume = Number(Array.isArray(header) ? header[0] : header);
        const asked = Number(url.searchParams.get("after"));
        const after = Math.max(
          Number.isSafeInteger(resume) && resume > 0 ? resume : 0,
          Number.isSafeInteger(asked) && asked > 0 ? asked : 0,
        );
        return stream(thread.id, after);
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/messages"),
      async run([id = ""], request) {
        const { text } = await readJson(request, messageBody, object({ text: unknown }));
        const { seq } = await deps.dispatch(
          "thread.say",
          checked("thread.say", { thread: id, text }),
          user,
        );
        return json(202, { seq });
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/stop"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("thread.stop", { thread: id });
        const { stopped } = await deps.dispatch("thread.stop", input, user);
        return json(200, { stopped });
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/done"),
      async run([id = ""], request) {
        // The body first: the thread may go while it's read.
        const { via } = await readJson(request, smallBody, object({ via: unknown }));
        await deps.dispatch("thread.done", checked("thread.done", { thread: id, via }), user);
        return json(200, await threadView(id as Ulid));
      },
    },
    {
      // What deleting the thread would lose, for the person to confirm.
      method: "GET",
      path: at("/threads/:id/deletion"),
      async run([id = ""]) {
        const thread = mustThread(id);
        const deletion: DeletionView = threads.wrote(thread.id);
        return json(200, deletion);
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/delete"),
      async run([id = ""], request) {
        const { via } = await readJson(request, smallBody, object({ via: unknown }));
        const input = checked("thread.delete", { thread: id, via });
        const { undo: _, ...deleted } = await deps.dispatch("thread.delete", input, user);
        return json(200, deleted satisfies DeletedView);
      },
    },
    {
      // A POST, because a diff reads the source and records what was shown.
      method: "POST",
      path: at("/change-sets/:id/diff"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const set = await mustChangeSet(id);
        const diff = await changeSets.diff(set.id);
        return json(200, views.diff(diff, set, changeSets.applying(set.id)));
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/edit"),
      async run([id = ""], request) {
        const { remove } = await readJson(request, smallBody, object({ remove: unknown }));
        const input = checked("changeset.edit", { changeSet: id, remove });
        await deps.dispatch("changeset.edit", input, user);
        return changeSetReply(input.changeSet);
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/approve"),
      async run([id = ""], request) {
        const { hash } = await readJson(request, smallBody, object({ hash: unknown }));
        const input = checked("changeset.approve", { changeSet: id, hash });
        const { report, problem } = await deps.dispatch("changeset.approve", input, user);
        return changeSetReply(input.changeSet, { report, problem });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/reject"),
      async run([id = ""], request) {
        const body = await readJson(
          request,
          messageBody,
          object({ hash: unknown, reason: unknown }),
        );
        const input = checked("changeset.reject", { changeSet: id, ...body });
        const { report, problem } = await deps.dispatch("changeset.reject", input, user);
        return changeSetReply(input.changeSet, { report, problem });
      },
    },
    {
      // A message held in the thread, from anyone but the user: they send it
      // to the agent, as it is or edited, or discard it.
      method: "POST",
      path: at("/threads/:id/held/:seq/send"),
      async run([id = "", place = ""], request) {
        const { text } = await readJson(request, messageBody, object({ text: unknown }));
        const input = checked("held.send", { thread: id, seq: Number(place), text });
        const { seq } = await deps.dispatch("held.send", input, user);
        return json(202, { seq });
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/held/:seq/discard"),
      async run([id = "", place = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("held.discard", { thread: id, seq: Number(place) });
        await deps.dispatch("held.discard", input, user);
        return json(200, await threadView(id as Ulid));
      },
    },
    {
      // Retries an approved change set that stopped partway.
      method: "POST",
      path: at("/change-sets/:id/apply"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("changeset.apply", { changeSet: id });
        const { report } = await deps.dispatch("changeset.apply", input, user);
        return changeSetReply(input.changeSet, { report });
      },
    },
    {
      // Ends a change set that can go no further. The warnings name changes
      // that may already have landed, for the person to check.
      method: "POST",
      path: at("/change-sets/:id/dismiss"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("changeset.dismiss", { changeSet: id });
        const { warnings } = await deps.dispatch("changeset.dismiss", input, user);
        return changeSetReply(input.changeSet, { warnings });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/revert"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("changeset.revert", { changeSet: id });
        const reverted = await deps.dispatch("changeset.revert", input, user);
        if (reverted.conflicts)
          return json(409, {
            error: deps.explain(reverted.conflicts),
            conflicts: reverted.conflicts.length,
          });
        return changeSetReply(input.changeSet, { revert: reverted.revert });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/review-link"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("review-link.create", { changeSet: id });
        const { url } = await deps.dispatch("review-link.create", input, user);
        return json(200, { url });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/review-link/revoke"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("review-link.revoke", { changeSet: id });
        await deps.dispatch("review-link.revoke", input, user);
        return json(200, { revoked: true });
      },
    },
    {
      // What a review link's page asks for once the person opens it: the
      // diff, without the thread.
      method: "POST",
      path: at("/review/open"),
      async run(_, request) {
        const { token } = await readJson(request, smallBody, tokenBody);
        const opened = await changeSets.openReview(token);
        if (!opened)
          throw new Refused(404, "This review link has expired, was revoked, or was already used.");
        // Its thread went with a workstream the user deleted, which they may
        // bring back, and the link with it (decision 0028). That counts as
        // refused, not opened (OA-143).
        const { workspaceId } = deps;
        const changeSetId = opened.changeSet.id;
        if (!(await liveChangeSet(deps, changeSetId))) {
          deps.emit({
            name: "review-link.refused",
            at: deps.now(),
            workspaceId,
            changeSetId,
            why: "deleted",
          });
          throw new Refused(
            404,
            "The workstream this change set is in was deleted, so it can't be reviewed now.",
          );
        }
        deps.emit({ name: "review-link.opened", at: deps.now(), workspaceId, changeSetId });
        await changeSets.reviewLinkOpened(token);
        return json(200, {
          changeSet: await viewOf(opened.changeSet),
          diff: views.diff(opened.diff, opened.changeSet, changeSets.applying(opened.changeSet.id)),
        });
      },
    },
    {
      method: "POST",
      path: at("/review/decide"),
      async run(_, request) {
        const body = await readJson(request, messageBody, reviewDecision);
        // The decision checks that the token is live for this change set.
        const holder: Actor = { kind: "review-link", by: body.name.trim() };
        const decision = { changeSet: body.changeSet, hash: body.hash, token: body.token };
        const { problem } =
          body.kind === "approved"
            ? await deps.dispatch("changeset.approve", decision, holder)
            : await deps.dispatch(
                "changeset.reject",
                { ...decision, ...(body.reason === undefined ? {} : { reason: body.reason }) },
                holder,
              );
        const set = await mustChangeSet(body.changeSet);
        return json(200, {
          changeSet: await viewOf(set),
          problem,
        });
      },
    },
    {
      // Ends what is left of a change set that started landing, as the
      // thread's dismiss does. The warnings name what may have landed.
      method: "POST",
      path: at("/review/dismiss"),
      async run(_, request) {
        const body = await readJson(request, smallBody, reviewDismissal);
        // The engine checks that the token is live for this change set.
        const { warnings } = await deps.dispatch(
          "changeset.dismiss",
          { changeSet: body.changeSet, hash: body.hash, token: body.token },
          { kind: "review-link", by: body.name.trim() },
        );
        const set = await mustChangeSet(body.changeSet);
        return json(200, { changeSet: await viewOf(set), warnings });
      },
    },
  ];

  return async (request, url) => {
    const path = url.pathname.replace(/^\/api\/groups(?=\/|$)/, "/api/workstreams");
    const matched = routes.flatMap((route) => {
      const match = route.path.exec(path);
      return match ? [{ route, params: match.slice(1) }] : [];
    });
    if (matched.length === 0) return null;
    const found = matched.find(({ route }) =>
      route.method === "GET"
        ? request.method === "GET" || request.method === "HEAD"
        : request.method === route.method,
    );
    if (!found) {
      const allow = matched.map(({ route }) =>
        route.method === "GET" ? "GET, HEAD" : route.method,
      );
      return {
        ...problem(405, "method not allowed"),
        headers: { "content-type": "application/json", allow: allow.join(", ") },
      };
    }
    try {
      return await found.route.run(found.params, request, url);
    } catch (error) {
      if (error instanceof Refused) return problem(error.status, error.message);
      if (
        error instanceof ThreadBusy ||
        error instanceof ThreadLimit ||
        error instanceof NothingHeld
      )
        return problem(409, error.message);
      if (error instanceof ActionError) return problem(actionStatus[error.code], error.message);
      const status = changeSetStatus(error);
      if (status !== null && error instanceof Error) return problem(status, error.message);
      deps.log("api: failed", { path: url.pathname, error: String(error) });
      throw error;
    }
  };
}
