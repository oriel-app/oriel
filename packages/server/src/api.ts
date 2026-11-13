// Behind site.ts's Host/Origin guard, which refuses a state change without this server's own Origin.
// A POST must send JSON within its route's size cap; nothing a GET does opens, decides or writes.
import {
  type Actor,
  type Call,
  array,
  type ChangeSet,
  type ChangeSets,
  type Conflict,
  type IndexRecord,
  type Instant,
  type Known,
  type ItemId,
  isInverse,
  isOverviewSection,
  isItemId,
  isUlid,
  type Log,
  literal,
  type LookingAt,
  lookingAt,
  maxItems,
  messageText,
  maxNameChars,
  number,
  object,
  type OrielReads,
  optional,
  refine,
  type ReviewEdit,
  reviewEdit,
  string,
  type TelemetryEvent,
  type Ulid,
  union,
  unknown,
  type Validator,
  type StartQuestion,
  startQuestions,
  toolName,
} from "@oriel/core";
import type { WorkstreamStore, Message, ThreadStore } from "@oriel/db";
import { connectorViews, parseDeclared, sourceKinds, sources } from "@oriel/sources";
import {
  type ContinuedView,
  type DeletedView,
  type DeletionView,
  browseFilter,
  type BrowseFilter,
  type ClusterPageView,
  type ConnectionsView,
  type GroupingId,
  type Undoable,
  type WorkstreamSummary,
  type WorkstreamDeletedView,
  type WorkstreamEndedView,
  isGroupingId,
  type PickChoiceView,
  type OptionsReviewView,
  type OverviewView,
  type ReviewRedrawn,
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
import { itemRef } from "./overview.ts";
import { aboutItem, aboutWorkstream, questionLabel } from "@oriel/web/questions";
import { type SettingsService, SettingsRefused, settingsChange } from "./settings.ts";
import { type Setup, SetupRefused } from "./setup/setup.ts";
import type { ItemPanels } from "./panel.ts";
import type { Reply, Request } from "./site.ts";
import { channel } from "./stream.ts";
import { NothingFailed, NothingHeld, ThreadBusy, ThreadLimit, type Turns } from "./turns.ts";
import type { NoticedService } from "./noticed.ts";
import type { OutsideTools } from "./mcp/tokens.ts";
import type { Door } from "./app.ts";
import { changeSetView, type Views } from "./views.ts";

export type ApiDeps = {
  workspaceId: Ulid;
  workstreams: WorkstreamStore;
  threads: ThreadStore;
  records(): readonly IndexRecord[];
  dispatch: Dispatch;
  undoLine(at: LinePlace, call: Call, actor: Actor): Promise<{ undo: Call | null }>;
  changeSets: ChangeSets;
  known(): Known;
  turns: Turns;
  views: Views;
  reads: OrielReads;
  items: ItemPanels;
  emit(event: TelemetryEvent): void;
  now(): Instant;
  refresh(): Promise<string | null>;
  explain(conflicts: readonly Conflict[]): string;
  browse: {
    rows(grouping: GroupingId, filter: BrowseFilter): WindowView;
    page(
      grouping: GroupingId,
      cluster: string,
      from: number,
      filter: BrowseFilter,
    ): ClusterPageView | null;
  };
  overview(): Promise<OverviewView>;
  noticed?: NoticedService;
  connections(): ConnectionsView;
  lookForServers(): Promise<void>;
  choices(
    id: string,
    query: string,
    field?: string,
  ): Promise<
    { choices: PickChoiceView[]; more: boolean } | { problem: string; fields?: readonly string[] }
  >;
  folderStep(kind: string): { field: string; prompt: string } | null;
  review(id: string, fresh: boolean, tab?: string): Promise<OptionsReviewView>;
  redraw(id: string, given: unknown, edit: ReviewEdit): Promise<ReviewRedrawn>;
  onboard(id: string, tab?: string): Promise<string | null>;
  onboarded(id: string, thread: string): void;
  pickFolder?: (prompt: string) => Promise<string | null>;
  settings: SettingsService;
  outside: { tools: OutsideTools; door: Door | null };
  setup: Setup;
  log: Log;
};

const smallBody = 4 * 1024;
const listBody = 64 * 1024;
const messageBody = 32 * 1024;

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const problem = (status: number, error: string): Reply => json(status, { error });

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
const openThreadBody = object({ text: optional(textValue), about: unknown });
const startQuestionValue = union(...startQuestions.map((question) => literal(question)));
const messageBodyValue = object({
  text: textValue,
  about: unknown,
  question: optional(
    object({
      kind: startQuestionValue,
      subject: optional(refine(string, (id) => id.length <= 255, "expected an ID")),
    }),
  ),
});
// How long a name may be is the dispatcher's to check.
const newThreadBody = object({
  text: textValue,
  workstreamName: optional(string),
  about: unknown,
});
// Checked before the thread is made, so a refused one makes none.
function firstAbout(about: unknown): { about?: LookingAt } {
  if (about === undefined) return {};
  const looked = lookingAt(about);
  if (!looked.ok) throw new Refused(400, "about: expected the items open");
  return { about: looked.value };
}
const tokenBody = object({ token: string });
// How long a holder's reason may be is the dispatcher's to check.
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
// Names the chat it opens, so a chat the window has moved on from since isn't the one moved.
const openBody = object({ thread: ulidValue });
const setupCommand = object({
  command: union(
    literal("check"),
    literal("install"),
    literal("sign-in"),
    literal("update"),
    literal("cancel"),
  ),
  cli: optional(union(literal("claude-code"), literal("codex"))),
});
const setupAi = object({
  ai: union(literal("claude-code"), literal("codex")),
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
const connectBody = object({ kind: unknown, given: unknown });
const pickerBody = object({ kind: string, given: optional(unknown) });
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
// IDs, never a name.
const tableAt = refine(
  string,
  (at) => /^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,40}$/.test(at),
  "expected a table's place",
);
const count = refine(number, (n) => Number.isSafeInteger(n) && n >= 0, "expected a count");
const windowEvent = union(
  object({
    name: literal("grouping.switched"),
    grouping: refine(string, isGroupingId, "expected epic, assignee, stuck or linked"),
  }),
  object({ name: literal("cluster.opened") }),
  object({ name: literal("cluster.closed") }),
  // The event keeps the item's source, never the item.
  object({ name: literal("item.panel-opened"), item: itemIdValue }),
  object({
    name: literal("item.source-opened"),
    item: itemIdValue,
    via: union(literal("panel"), literal("link")),
  }),
  object({ name: literal("item.asked-about"), item: itemIdValue }),
  object({ name: literal("item.dropped-on-composer"), item: itemIdValue }),
  // How long the query was, never what it said.
  object({ name: literal("threads.searched"), queryLength: count, results: count }),
  object({ name: literal("items.searched"), queryLength: count, results: count }),
  object({
    name: literal("threads.search-opened"),
    opened: union(literal("thread"), literal("change-set")),
    rank: count,
  }),
  object({ name: literal("overview.opened") }),
  object({ name: literal("block.regrouped") }),
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
    question: startQuestionValue,
  }),
  object({
    name: literal("first-run.details-copied"),
    what: union(
      literal("install"),
      literal("sign-in"),
      literal("update"),
      literal("test"),
      ...sourceKinds.map((kind) => literal(kind)),
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

const actionStatus = { invalid: 400, refused: 403, "not-found": 404, conflict: 409 } as const;

const user: Actor = { kind: "user" };

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

function groupingOf(params: URLSearchParams): GroupingId {
  const grouping = params.get("grouping");
  if (!isGroupingId(grouping))
    throw new Refused(400, "grouping must be epic, assignee, stuck or linked");
  return grouping;
}

// A source or an assignee the index doesn't have keeps nothing, so an old address shows that, rather than failing.
function filterOf(params: URLSearchParams): BrowseFilter {
  const filter = browseFilter(params);
  if (params.get("status")?.trim() && !filter.status)
    throw new Refused(400, "status must be todo, in-progress or done");
  return filter.q ? { ...filter, q: filter.q.slice(0, maxQueryChars) } : filter;
}

function fromOf(params: URLSearchParams): number {
  const from = Number(params.get("from") ?? 0);
  if (!Number.isSafeInteger(from) || from < 0)
    throw new Refused(400, "from must be a whole number, from 0");
  return from;
}

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
const itemPart = "([^/]{1,512})";
const seqPart = "([1-9][0-9]{0,8})";
// Workstreams were once called groups: /api/groups/… still answers, for a tab opened before then.
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
  const mustNoticed = () => {
    if (!deps.noticed) throw new Refused(404, "Noticed isn't on here");
    return deps.noticed;
  };
  const mustThread = (id: string) => {
    const thread = threads.get(id as Ulid, deps.now());
    if (!thread || thread.workspaceId !== deps.workspaceId)
      throw new Refused(404, "no such thread");
    return thread;
  };
  // Rebuilt from Oriel's own data by kind and subject ID, never taken from the page.
  const questionTitle = (kind: StartQuestion, subject: string | undefined): string | null => {
    let name = "";
    if (aboutWorkstream.includes(kind)) {
      const workstream = subject === undefined ? null : workstreams.get(subject as Ulid);
      if (!workstream || workstream.workspaceId !== deps.workspaceId) return null;
      name = workstream.name;
    } else if (aboutItem.includes(kind)) {
      const record = deps.records().find((one) => one.id === subject);
      if (!record) return null;
      const ref = itemRef(record);
      name = ref.title ?? ref.key;
    }
    return questionLabel(kind, name);
  };
  const windowChatThread = async (): Promise<{ thread: Ulid; made: boolean }> => {
    const open = deps.threads.windowChat(deps.workspaceId, deps.now());
    if (open) return { thread: open.id, made: false };
    const { workstream } = await deps.dispatch("workstream.create", { kind: "window" }, user);
    const { thread } = await deps.dispatch("thread.open", { workstream }, user);
    deps.emit({
      name: "window-chat.opened",
      at: deps.now(),
      workspaceId: deps.workspaceId,
      threadId: thread,
    });
    return { thread, made: true };
  };
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

  const mustItem = (text: string) => {
    const parsed = parseDeclared(text);
    if (!parsed) throw new Refused(400, "expected an item ID");
    return { id: text as ItemId, source: parsed.kind };
  };

  const viewOf = async (set: ChangeSet) =>
    changeSetView(
      set,
      await changeSets.ofThread(set.threadId),
      await changeSets.nextSteps(set.id),
      changeSets.applying(set.id),
      changeSets.writable(set.id),
      changeSets.stalled(set.id),
      changeSets.cannotUndo(set.id),
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
      (id) => changeSets.cannotUndo(id as Ulid),
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
    // Watch first, then catch up, in one synchronous step, so no entry falls between the two.
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
    // A thread's page hears the rest of the workspace on this stream too, so a tab holds one stream at most:
    // browsers allow few per host.
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
      // No reply carries a key, only whether one is set.
      method: "GET",
      path: at("/settings"),
      run: async () => json(200, deps.settings.view()),
    },
    {
      // A POST, since it starts the CLI: only the window's own origin asks.
      method: "POST",
      path: at("/settings/usage"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        return json(200, { usage: await deps.settings.usage() });
      },
    },
    {
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
      // No token is in it.
      method: "GET",
      path: at("/outside-tools"),
      run: async () =>
        json(200, {
          door: deps.outside.door,
          tools: deps.outside.tools
            .list()
            .map(({ id, name, mode, connectedAt, usedAt, revokedAt }) => ({
              id,
              name,
              mode,
              connectedAt,
              usedAt,
              revokedAt,
            })),
        }),
    },
    {
      // Its token is in this reply alone.
      method: "POST",
      path: at("/outside-tools"),
      async run(_, request) {
        const { name, mode } = await readJson(
          request,
          smallBody,
          object({ name: toolName, mode: union(literal("read"), literal("act")) }),
        );
        try {
          const { tool, token } = deps.outside.tools.connect(name, mode);
          return json(200, { tool: { id: tool.id, name: tool.name, mode: tool.mode }, token });
        } catch (error) {
          if (error instanceof RangeError) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
      method: "POST",
      path: at("/outside-tools/:id/revoke"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        if (!deps.outside.tools.revoke(id as Ulid)) throw new Refused(404, "no such tool");
        return json(200, {});
      },
    },
    {
      method: "POST",
      path: at("/settings/look"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        return json(200, await deps.settings.look());
      },
    },
    {
      method: "GET",
      path: at("/setup"),
      run: async () => json(200, await deps.setup.view()),
    },
    {
      // A command from a fixed list.
      method: "POST",
      path: at("/setup/cli"),
      async run(_, request) {
        const { command, cli } = await readJson(request, smallBody, setupCommand);
        try {
          return json(200, await deps.setup.command(command, cli ?? "claude-code"));
        } catch (error) {
          if (error instanceof SetupRefused) throw new Refused(409, error.message);
          throw error;
        }
      },
    },
    {
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
      path: at("/connectors"),
      run: async () => json(200, { connectors: connectorViews }),
    },
    {
      method: "GET",
      path: at("/connections"),
      run: async () => json(200, deps.connections()),
    },
    {
      method: "POST",
      path: at("/connections"),
      async run(_, request) {
        const { kind, given } = await readJson(request, smallBody, connectBody);
        const input = checked("source.connect", { kind, given });
        const connected = await deps.dispatch("source.connect", input, user);
        return "problem" in connected
          ? json(400, { error: connected.problem, fields: connected.fields ?? [] })
          : json(200, connected);
      },
    },
    {
      // Drawn from the source, never from the drafter's words.
      method: "GET",
      path: at("/connections/:id/review"),
      // Try again reads the source afresh; the window's own polling doesn't.
      run: async ([id = ""], _request, url) => {
        const tab = url.searchParams.get("tab");
        if (tab !== null && !tableAt(tab).ok) throw new Refused(400, "expected a table's place");
        const fresh = url.searchParams.get("fresh") === "1";
        return json(200, await deps.review(id, fresh, tab ?? undefined));
      },
    },
    {
      method: "POST",
      path: at("/connections/:id/review"),
      async run([id = ""], request) {
        const { given, edit } = await readJson(
          request,
          listBody,
          object({ given: unknown, edit: reviewEdit }),
        );
        return json(200, await deps.redraw(id, given, edit));
      },
    },
    {
      // From the connector's own words, which name nothing synced.
      method: "POST",
      path: at("/connections/:id/draft"),
      async run([id = ""], request) {
        const { tab } = await readJson(request, tinyBody, object({ tab: optional(tableAt) }));
        const text = await deps.onboard(id, tab);
        if (text === null) return json(200, { thread: null });
        const { thread } = await windowChatThread();
        if (tab === undefined) deps.onboarded(id, thread);
        await deps.dispatch("thread.say", { thread, text }, user);
        return json(201, { thread });
      },
    },
    {
      method: "POST",
      path: at("/connections/picker"),
      async run(_, request) {
        const body = await readJson(request, smallBody, pickerBody);
        const step = deps.folderStep(body.kind);
        if (!deps.pickFolder || step === null)
          throw new Refused(409, "Type the folder's path: there's no picker here.");
        const { field } = step;
        let picked: string | null;
        try {
          picked = await deps.pickFolder(step.prompt);
        } catch {
          throw new Refused(409, "The folder picker didn't open. Try again.");
        }
        if (picked === null) return json(200, { picked: false });
        const given = { ...(body.given as object | undefined), [field]: picked };
        const input = checked("source.connect", { kind: body.kind, given });
        const connected = await deps.dispatch("source.connect", input, user);
        if ("problem" in connected) throw new Refused(400, connected.problem);
        return json(200, { ...connected, picked: true });
      },
    },
    {
      method: "POST",
      path: at("/connections/:id/pick"),
      async run([id = ""], request) {
        const { query, field } = await readJson(
          request,
          smallBody,
          object({ query: optional(typedText(100)), field: optional(typedText(40)) }),
        );
        const listed = await deps.choices(id, query ?? "", field);
        return "problem" in listed
          ? json(400, { error: listed.problem, fields: listed.fields ?? [] })
          : json(200, listed);
      },
    },
    {
      // A spreadsheet's mappings are longer than most.
      method: "POST",
      path: at("/connections/:id/options"),
      async run([id = ""], request) {
        const { options } = await readJson(request, listBody, object({ options: unknown }));
        const input = checked("source.configure", { connection: id, options });
        const configured = await deps.dispatch("source.configure", input, user);
        if (!("connection" in configured)) throw new Refused(400, configured.problem);
        return json(200, configured);
      },
    },
    {
      method: "POST",
      path: at("/servers/look"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        await deps.lookForServers();
        return json(200, deps.connections());
      },
    },
    {
      method: "POST",
      path: at("/servers/dismiss"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        await deps.dispatch("source.dismiss-found", {}, user);
        return json(200, deps.connections());
      },
    },
    {
      // Its source failing it is a 502: the request was fine.
      method: "POST",
      path: at("/connections/:id/sync"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("source.sync", { connection: id });
        const synced = await deps.dispatch("source.sync", input, user);
        if ("problem" in synced) throw new Refused(502, synced.problem);
        return json(200, synced);
      },
    },
    {
      method: "POST",
      path: at("/connections/:id/disconnect"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("source.disconnect", { connection: id });
        return json(200, await deps.dispatch("source.disconnect", input, user));
      },
    },
    {
      method: "GET",
      path: at("/browse"),
      run: async (_, _request, url) =>
        json(200, deps.browse.rows(groupingOf(url.searchParams), filterOf(url.searchParams))),
    },
    {
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
      path: at("/overview"),
      async run() {
        return json(200, await deps.overview());
      },
    },
    {
      method: "GET",
      path: at("/noticed"),
      run: async () => json(200, await mustNoticed().view()),
    },
    {
      method: "POST",
      path: at("/noticed/dismiss"),
      async run(_, request) {
        const typed = await readJson(request, tinyBody, object({ signal: unknown }));
        await deps.dispatch("noticed.dismiss", checked("noticed.dismiss", typed), user);
        return json(200, {});
      },
    },
    {
      method: "POST",
      path: at("/noticed/pin"),
      async run(_, request) {
        const typed = await readJson(request, tinyBody, object({ signal: unknown }));
        return json(201, await deps.dispatch("noticed.pin", checked("noticed.pin", typed), user));
      },
    },
    {
      method: "POST",
      path: at("/pins/:id/remove"),
      async run([id = ""], request) {
        await readJson(request, tinyBody, emptyBody);
        await deps.dispatch("noticed.unpin", { pin: id as Ulid }, user);
        return json(200, {});
      },
    },
    {
      // `seq` is the last change log entry the page counted, so one that committed after it rendered stays unseen.
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
            : event.name === "item.panel-opened" ||
                event.name === "item.asked-about" ||
                event.name === "item.dropped-on-composer"
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
      // The call the server gave, sent back as it is, so only an action that undoes another comes this way.
      method: "POST",
      path: /^\/api\/actions\/([a-z]+\.[a-z]+)$/,
      async run([name = ""], request, url) {
        if (!isInverse(name)) throw new Refused(404, "no such undo");
        const input = await readJson(request, listBody, unknown);
        const at = linePlace(url.searchParams);
        const done = at
          ? await deps.undoLine(at, { action: name, input } as Call, user)
          : await deps.dispatch.untyped(name, input, user);
        const { problem } = done as { problem?: unknown };
        return json(200, { undo: done.undo, ...(typeof problem === "string" ? { problem } : {}) });
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
        const { text, about } = await readJson(request, messageBody, openThreadBody);
        const looked = firstAbout(about);
        const opened = checked("thread.open", { workstream: id });
        const { thread } = await deps.dispatch("thread.open", opened, user);
        if (text !== undefined)
          await deps.dispatch("thread.say", { thread, text, ...looked }, user);
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
      // Until its first message is sent, the thread is only a draft in the browser, so one abandoned leaves nothing behind.
      method: "POST",
      path: at("/threads"),
      async run(_, request) {
        const { text, workstreamName, about } = await readJson(request, messageBody, newThreadBody);
        const looked = firstAbout(about);
        const made = checked("workstream.create", {
          kind: "thread",
          ...(workstreamName === undefined ? {} : { name: workstreamName }),
        });
        const { workstream } = await deps.dispatch("workstream.create", made, user);
        const { thread } = await deps.dispatch("thread.open", { workstream }, user);
        await deps.dispatch("thread.say", { thread, text, ...looked }, user);
        return json(201, { id: thread, workstreamId: workstream });
      },
    },
    {
      method: "GET",
      path: at("/window-chat"),
      run: async () =>
        json(200, { thread: deps.threads.windowChat(deps.workspaceId, deps.now())?.id ?? null }),
    },
    {
      method: "POST",
      path: at("/window-chat/messages"),
      async run(_, request) {
        const { text, about, question } = await readJson(request, messageBody, messageBodyValue);
        const looked = firstAbout(about);
        const { thread, made } = await windowChatThread();
        const title = made && question && questionTitle(question.kind, question.subject);
        if (title) turns.titled(thread, title);
        const { seq } = await deps.dispatch("thread.say", { thread, text, ...looked }, user);
        return json(made ? 201 : 202, { id: thread, seq });
      },
    },
    {
      method: "POST",
      path: at("/window-chat/new"),
      async run(_, request) {
        await readJson(request, tinyBody, emptyBody);
        const { left } = await deps.dispatch("window.new-chat", {}, user);
        return json(200, { left });
      },
    },
    {
      method: "POST",
      path: at("/window-chat/open"),
      async run(_, request) {
        const { thread } = await readJson(request, tinyBody, openBody);
        const { moved } = await deps.dispatch("window.open-as-thread", { thread }, user);
        return json(200, { moved });
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
        const { text, about } = await readJson(
          request,
          messageBody,
          object({ text: unknown, about: unknown }),
        );
        const { seq } = await deps.dispatch(
          "thread.say",
          checked("thread.say", { thread: id, text, about }),
          user,
        );
        return json(202, { seq });
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/retry"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("thread.retry", { thread: id });
        const { seq } = await deps.dispatch("thread.retry", input, user);
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
      method: "POST",
      path: at("/threads/:id/sync"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        await deps.dispatch("thread.sync", checked("thread.sync", { thread: id }), user);
        return json(200, await threadView(id as Ulid));
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/continue"),
      async run([id = ""], request) {
        const { workstream } = await readJson(request, smallBody, object({ workstream: unknown }));
        const input = checked("thread.continue", { thread: id, workstream });
        const { thread, kept, undo } = await deps.dispatch("thread.continue", input, user);
        return json(201, { thread, kept, undo } satisfies Undoable<ContinuedView>);
      },
    },
    {
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
      method: "GET",
      path: at("/change-sets/:id/diff"),
      async run([id = ""]) {
        const set = await mustChangeSet(id);
        const diff = await changeSets.stored(set.id, deps.known());
        return json(200, views.diff(diff, set, changeSets.applying(set.id)));
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
      path: at("/change-sets/:id/second-look"),
      async run([id = ""], request) {
        await readJson(request, smallBody, emptyBody);
        const input = checked("changeset.second-look", { changeSet: id });
        await deps.dispatch("changeset.second-look", input, user);
        return changeSetReply(input.changeSet);
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/suggestions"),
      async run([id = ""], request) {
        const { look, places } = await readJson(
          request,
          smallBody,
          object({ look: unknown, places: unknown }),
        );
        const input = checked("changeset.add-suggestion", { changeSet: id, look, places });
        await deps.dispatch("changeset.add-suggestion", input, user);
        return changeSetReply(input.changeSet);
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/second-look/dismiss"),
      async run([id = ""], request) {
        const { look } = await readJson(request, smallBody, object({ look: unknown }));
        const input = checked("changeset.dismiss-look", { changeSet: id, look });
        await deps.dispatch("changeset.dismiss-look", input, user);
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
        const { report, problem, undo } = await deps.dispatch("changeset.reject", input, user);
        return changeSetReply(input.changeSet, { report, problem, undo });
      },
    },
    {
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
      path: at("/threads/:id/held/:seq/apply"),
      async run([id = "", place = ""], request) {
        const { edit } = await readJson(request, smallBody, object({ edit: unknown }));
        const input = checked("held.apply", { thread: id, seq: Number(place), edit });
        const { applied, ...outcome } = await deps.dispatch("held.apply", input, user);
        return json(200, { ...outcome, undo: applied });
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
      method: "POST",
      path: at("/review/open"),
      async run(_, request) {
        const { token } = await readJson(request, smallBody, tokenBody);
        const opened = await changeSets.openReview(token);
        if (!opened)
          throw new Refused(404, "This review link has expired, was revoked, or was already used.");
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
          connectors: connectorViews,
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
        error instanceof NothingHeld ||
        error instanceof NothingFailed
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
