// The JSON routes. Every route is behind the Host/Origin guard (site.ts),
// which also refuses a request that changes state unless it carries this
// server's own Origin. On top of that, a POST must send JSON, within its
// route's size cap. GETs read; nothing a GET does opens, decides or writes.
import {
  type Actor,
  array,
  closeVia,
  type ChangeSet,
  type ChangeSets,
  type Conflict,
  type IndexRecord,
  type Instant,
  type ItemId,
  isInverse,
  isItemId,
  isUlid,
  type Log,
  literal,
  maxItems,
  maxNameChars,
  number,
  object,
  optional,
  parseItemId,
  refine,
  string,
  type TelemetryEvent,
  type Ulid,
  union,
  unknown,
  type Validator,
} from "@oriel/core";
import type { GroupStore, Message, ThreadStore } from "@oriel/db";
import { sources } from "@oriel/sources";
import {
  type DeletedView,
  type DeletionView,
  type FolderView,
  isGroupingId,
  type JiraView,
  type StreamEvent,
} from "@oriel/web/view";
import { ActionError, type Dispatch } from "./actions.ts";
import { resolveDropped } from "./dropped.ts";
import type { ItemPanels } from "./panel.ts";
import type { Reply, Request } from "./site.ts";
import { channel } from "./stream.ts";
import { ThreadBusy, ThreadLimit, type Turns } from "./turns.ts";
import { changeSetView, type Views } from "./views.ts";

export type ApiDeps = {
  workspaceId: Ulid;
  groups: GroupStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records(): readonly IndexRecord[];
  // Oriel's own actions, through the one dispatcher (decision 0024).
  dispatch: Dispatch;
  changeSets: ChangeSets;
  turns: Turns;
  views: Views;
  // One item for the panel beside the page, read live, and when the index
  // last saw it change.
  items: ItemPanels;
  emit(event: TelemetryEvent): void;
  now(): Instant;
  newId(): Ulid;
  // After a change set applied, partly or in full: what it created joins the
  // group, and a live index syncs.
  applied(set: ChangeSet): Promise<void>;
  // Syncs the sources that change outside Oriel, once, so a dropped link to
  // an item made since the last sync can be found. What went wrong, in plain
  // words, or null.
  refresh(): Promise<string | null>;
  // Revert conflicts in plain words.
  explain(conflicts: readonly Conflict[]): string;
  // The connected folder: its state, connecting one by its typed path, and
  // syncing it again. A refusal is a plain sentence.
  folder: {
    view(): FolderView | null;
    connect(path: string): Promise<{ folder: FolderView } | { problem: string }>;
    sync(): Promise<{ folder: FolderView } | { problem: string }>;
  };
  // Jira: its state, connecting it with the details the user typed, and
  // syncing it on demand. A failure is a plain sentence.
  jira: {
    view(): JiraView;
    connect(details: JiraDetails): Promise<{ jira: JiraView } | { problem: string }>;
    sync(): Promise<{ jira: JiraView } | { problem: string }>;
  };
  log: Log;
};

// What the user types to connect Jira. Validation messages never quote a value.
export type JiraDetails = { site: string; email: string; token: string; project: string };

// Body caps, in bytes.
const smallBody = 4 * 1024;
const listBody = 64 * 1024;
const messageBody = 32 * 1024;
const maxMessageChars = 8_000;

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
const textValue = refine(
  string,
  (text) => text.trim() !== "" && text.length <= maxMessageChars,
  `expected a message of 1 to ${maxMessageChars} characters`,
);
const maxDropped = 50;
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
const hashBody = object({ hash: string });
const editBody = object({
  remove: refine(array(ulidValue), (ids) => ids.length > 0, "nothing to remove"),
});
const tokenBody = object({ token: string });
// A reason goes with a rejection only: it becomes the thread's next message.
const reasonValue = optional(textValue);
const rejectBody = object({ hash: string, reason: reasonValue });
const reviewDecision = refine(
  object({
    token: string,
    changeSet: ulidValue,
    kind: union(literal("approved"), literal("rejected")),
    name: nameValue,
    hash: string,
    reason: reasonValue,
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
const closeBody = object({ via: closeVia });
// The window makes a group from a cluster or from picked items; a group from
// nothing comes only with its thread.
const windowGroup = refine(
  unknown,
  (body) =>
    typeof body === "object" &&
    body !== null &&
    "kind" in body &&
    (body.kind === "cluster" || body.kind === "picked"),
  "expected a cluster or picked items",
);
const folderBody = object({
  path: refine(
    string,
    (path) => path.trim() !== "" && path.length <= 1024 && !path.includes("\0"),
    "expected a folder path",
  ),
});
const typedValue = (max: number, what: string) =>
  refine(string, (text) => text.trim() !== "" && text.length <= max, `expected ${what}`);
const jiraBody = object({
  site: typedValue(200, "a site"),
  email: typedValue(254, "an email address"),
  token: typedValue(1024, "an API token"),
  project: typedValue(32, "a project key"),
});
const tinyBody = 256;
const zoomId = union(literal("cluster"), literal("list"), literal("item"));
const windowEvent = union(
  object({
    name: literal("grouping.switched"),
    grouping: refine(string, isGroupingId, "expected epic, assignee or stuck"),
  }),
  object({ name: literal("zoom.changed"), from: zoomId, to: zoomId }),
  // By the item, whose source the event keeps; the item itself isn't kept.
  object({ name: literal("item.panel-opened"), item: itemIdValue }),
  object({
    name: literal("item.source-opened"),
    item: itemIdValue,
    via: union(literal("panel"), literal("link")),
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
const actionStatus = { invalid: 400, refused: 403, "not-found": 404 } as const;

// The window's door is the user's.
const user: Actor = { kind: "user" };

// A change-set refusal (`ChangeSetError`, by its name and code) as an HTTP
// status; null for any other error.
function changeSetStatus(error: unknown): number | null {
  if (!(error instanceof Error) || error.name !== "ChangeSetError" || !("code" in error))
    return null;
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
const at = (path: string) =>
  new RegExp(`^/api${path.replaceAll(":id", ulidPart).replaceAll(":item", itemPart)}$`);

export function api(deps: ApiDeps): (request: Request, url: URL) => Promise<Reply | null> {
  const { groups, threads, changeSets, turns, views } = deps;

  const mustGroup = (id: string) => {
    const group = groups.get(id as Ulid);
    if (!group || group.workspaceId !== deps.workspaceId) throw new Refused(404, "no such group");
    return group;
  };
  // Opens a thread on a group's current version, and starts its first turn
  // when it opens with a message.
  const openThread = (groupId: Ulid, version: number, text: string | undefined): Ulid => {
    const threadId = deps.newId();
    const now = deps.now();
    threads.open({ id: threadId, workspaceId: deps.workspaceId, groupId }, now);
    deps.emit({
      name: "thread.opened",
      at: now,
      workspaceId: deps.workspaceId,
      threadId,
      groupId,
      regionSize: groups.region(groupId, version)?.items.length ?? 0,
    });
    if (text !== undefined) turns.say(threadId, text);
    else turns.touched(threadId);
    return threadId;
  };
  const mustThread = (id: string) => {
    const thread = threads.get(id as Ulid, deps.now());
    if (!thread || thread.workspaceId !== deps.workspaceId)
      throw new Refused(404, "no such thread");
    return thread;
  };
  // A change set of a deleted thread, kept for what it wrote, is gone with it.
  const mustChangeSet = async (id: string) => {
    const set = await changeSets.get(id as Ulid);
    if (!set || set.workspaceId !== deps.workspaceId || !threads.get(set.threadId, deps.now()))
      throw new Refused(404, "no such change set");
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
    return views.thread(threadId, sets, steps, (id) => changeSets.applying(id as Ulid));
  };

  // Every action that changes a change set tells the pages watching its
  // thread, through this: whether it is applying now, or has changed.
  const tell = (set: { id: Ulid; threadId: Ulid }, applying: boolean) =>
    turns.changeSet(set.threadId, set.id, applying);

  // Applies a change set, and tells when that starts and when it ends. The
  // engine marks it applying before `apply` returns its promise, so the first
  // reload sees that.
  const applyTold = async (id: Ulid) => {
    const set = await mustChangeSet(id);
    const applying = changeSets.apply(id);
    tell(set, true);
    try {
      return await applying;
    } finally {
      tell(set, false);
    }
  };

  // Decides, and on approval applies at once: approving is what lets Oriel
  // write, so replay follows it (decision 0003). A rejection is the thread's
  // to answer: it asks what was wrong, and a reason given with it is the
  // answer, which starts a turn. A reason that can't be said, mid-turn or
  // past the thread's caps, leaves the rejection standing, and says why.
  const decide = async (
    id: Ulid,
    kind: "approved" | "rejected",
    approver: Parameters<ChangeSets["decide"]>[2],
    hash: string,
    reason: string | null = null,
  ) => {
    const decided = await changeSets.decide(id, kind, approver, hash);
    if (kind === "rejected") {
      tell(decided, false);
      try {
        turns.rejected(decided, approver.via === "review-link" ? approver.by : null, reason);
        return { report: null, problem: null };
      } catch (error) {
        if (!(error instanceof ThreadBusy || error instanceof ThreadLimit)) throw error;
        // A reviewer can't stop the agent or start a thread: whoever shared
        // the link can.
        const problem =
          approver.via === "review-link"
            ? "Rejected, but the thread can't take your reason now. Send it to whoever shared this link."
            : error.message;
        return { report: null, problem };
      }
    }
    // The decision stands even if applying it is refused (another apply is
    // under way, say): the change set says where it stands, and why.
    try {
      const report = await applyTold(id);
      await deps.applied(await mustChangeSet(id));
      return { report, problem: null };
    } catch (error) {
      if (changeSetStatus(error) === null || !(error instanceof Error)) throw error;
      return { report: null, problem: error.message };
    }
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
      else if (event.type === "group") send({ type: "group" });
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
      method: "GET",
      path: at("/folder"),
      run: async () => json(200, { folder: deps.folder.view() }),
    },
    {
      // Connects the folder whose path the user typed: there is no native
      // picker on localhost. Only a directory is taken; its items sync into
      // the index at once.
      method: "POST",
      path: at("/folder"),
      async run(_, request) {
        const { path } = await readJson(request, smallBody, folderBody);
        const connected = await deps.folder.connect(path);
        if ("problem" in connected) throw new Refused(400, connected.problem);
        return json(200, connected);
      },
    },
    {
      method: "POST",
      path: at("/folder/sync"),
      async run(_, request) {
        await readJson(request, smallBody, emptyBody);
        const synced = await deps.folder.sync();
        if ("problem" in synced) throw new Refused(409, synced.problem);
        return json(200, synced);
      },
    },
    {
      method: "GET",
      path: at("/jira"),
      run: async () => json(200, { jira: deps.jira.view() }),
    },
    {
      // Connects Jira with the details the user typed. They're checked
      // against the site before anything is kept, and its items sync into
      // the index at once. The token is never sent back.
      method: "POST",
      path: at("/jira"),
      async run(_, request) {
        const details = await readJson(request, smallBody, jiraBody);
        const connected = await deps.jira.connect(details);
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
        if (!deps.jira.view().connected)
          throw new Refused(409, "Jira isn't connected to this window yet.");
        const synced = await deps.jira.sync();
        if ("problem" in synced) throw new Refused(502, synced.problem);
        return json(200, synced);
      },
    },
    {
      // What only the window knows happened. Four events, fixed fields.
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
                : {
                    name: event.name,
                    at,
                    workspaceId,
                    source: sourceOf(event.item),
                    via: event.via,
                  },
        );
        return json(202, {});
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
      // is that call's own undo.
      method: "POST",
      path: /^\/api\/actions\/([a-z]+\.[a-z]+)$/,
      async run([name = ""], request) {
        if (!isInverse(name)) throw new Refused(404, "no such undo");
        const input = await readJson(request, listBody, unknown);
        const { undo } = await deps.dispatch(name, input, user);
        return json(200, { undo });
      },
    },
    {
      method: "GET",
      path: at("/groups"),
      run: async () => json(200, { groups: views.groups(deps.workspaceId) }),
    },
    {
      method: "POST",
      path: at("/groups"),
      async run(_, request) {
        const body = await readJson(request, listBody, windowGroup);
        const { group } = await deps.dispatch("group.create", body, user);
        return json(201, views.groupSummary(group));
      },
    },
    {
      method: "GET",
      path: at("/groups/:id"),
      async run([id = ""]) {
        mustGroup(id);
        return json(200, await views.group(id as Ulid));
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/add"),
      async run([id = ""], request) {
        const { items } = await readJson(request, listBody, itemsBody);
        const { undo } = await deps.dispatch("group.add", { group: id, items }, user);
        return json(200, { ...(await views.group(id as Ulid)), undo });
      },
    },
    {
      // What the user dropped on the group or one of its threads: links, text
      // and file names, as dropped.ts reads them. What names nothing in the
      // index is retried once after a sync, then refused in plain words; the
      // rest is added as the user picking it would be.
      method: "POST",
      path: at("/groups/:id/drop"),
      async run([id = ""], request) {
        const group = mustGroup(id);
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
          ? await deps.dispatch("group.add", { group: group.id, items: resolved.ids }, user)
          : { added: [], undo: null };
        const refused = resolved.refused.map(({ what, why, syncMightHelp }) => ({
          what,
          why: synced && syncMightHelp ? `${why} ${synced}` : why,
        }));
        return json(200, { group: await views.group(group.id), added, refused, undo });
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/remove"),
      async run([id = ""], request) {
        const { items } = await readJson(request, listBody, itemsBody);
        const { undo } = await deps.dispatch("group.remove", { group: id, items }, user);
        return json(200, { ...(await views.group(id as Ulid)), undo });
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/rename"),
      async run([id = ""], request) {
        const { name } = await readJson(request, smallBody, object({ name: unknown }));
        const { undo } = await deps.dispatch("group.rename", { group: id, name }, user);
        return json(200, { ...views.groupSummary(id as Ulid), undo });
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/threads"),
      async run([id = ""], request) {
        const group = mustGroup(id);
        const { text } = await readJson(request, messageBody, openThreadBody);
        return json(201, { id: openThread(group.id, group.version, text) });
      },
    },
    {
      method: "GET",
      path: at("/threads"),
      run: async () => json(200, { threads: await views.threads(deps.workspaceId) }),
    },
    {
      // A thread from nothing, with its first message: on a new group with no
      // items, where the agent may only create them, as when a plan starts
      // with its epic. Until that message is sent, the thread is only a draft
      // in the browser, so one abandoned leaves nothing behind.
      method: "POST",
      path: at("/threads"),
      async run(_, request) {
        const { text } = await readJson(request, messageBody, messageBodyValue);
        const { group: groupId } = await deps.dispatch("group.create", { kind: "thread" }, user);
        const group = mustGroup(groupId);
        return json(201, { id: openThread(group.id, group.version, text), groupId });
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
        const thread = mustThread(id);
        const { text } = await readJson(request, messageBody, messageBodyValue);
        return json(202, turns.say(thread.id, text));
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/stop"),
      async run([id = ""], request) {
        const thread = mustThread(id);
        await readJson(request, smallBody, emptyBody);
        return json(200, { stopped: turns.stop(thread.id) });
      },
    },
    {
      method: "POST",
      path: at("/threads/:id/done"),
      async run([id = ""], request) {
        // The body first: the thread may go while it's read.
        const { via } = await readJson(request, smallBody, object({ via: unknown }));
        await deps.dispatch("thread.done", { thread: id, via }, user);
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
      // Not while its agent answers or a change set of it applies: either
      // may yet write.
      method: "POST",
      path: at("/threads/:id/delete"),
      async run([id = ""], request) {
        const { via } = await readJson(request, smallBody, closeBody);
        const thread = mustThread(id);
        if (turns.running(thread.id)) throw new ThreadBusy();
        const now = deps.now();
        const deleted = threads.delete(thread.id, now, (set) => changeSets.applying(set));
        if (!deleted)
          throw new Refused(
            409,
            "A change set of this thread is being applied. Wait for it to finish.",
          );
        turns.deleted(thread.id);
        deps.emit({
          name: "thread.deleted",
          at: now,
          workspaceId: deps.workspaceId,
          threadId: thread.id,
          groupId: deleted.groupId,
          kept: deleted.kept,
          groupRemoved: deleted.groupRemoved,
          via: via ?? "menu",
        });
        const reply: DeletedView = { groupId: deleted.groupId, groupRemoved: deleted.groupRemoved };
        return json(200, reply);
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
        const set = await mustChangeSet(id);
        const { remove } = await readJson(request, smallBody, editBody);
        tell(await changeSets.edit(set.id, { remove }), false);
        return changeSetReply(set.id);
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/approve"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        const { hash } = await readJson(request, smallBody, hashBody);
        const decided = await decide(set.id, "approved", { via: "thread", by: "user" }, hash);
        return changeSetReply(set.id, decided);
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/reject"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        const { hash, reason } = await readJson(request, messageBody, rejectBody);
        const decided = await decide(
          set.id,
          "rejected",
          { via: "thread", by: "user" },
          hash,
          reason ?? null,
        );
        return changeSetReply(set.id, decided);
      },
    },
    {
      // Retries an approved change set that stopped partway.
      method: "POST",
      path: at("/change-sets/:id/apply"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        await readJson(request, smallBody, emptyBody);
        const report = await applyTold(set.id);
        await deps.applied(await mustChangeSet(set.id));
        return changeSetReply(set.id, { report });
      },
    },
    {
      // Ends a change set that can go no further. The warnings name changes
      // that may already have landed, for the person to check.
      method: "POST",
      path: at("/change-sets/:id/dismiss"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        await readJson(request, smallBody, emptyBody);
        const { warnings } = await changeSets.dismiss(set.id);
        tell(set, false);
        return changeSetReply(set.id, { warnings });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/revert"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        await readJson(request, smallBody, emptyBody);
        const reverted = await changeSets.revert(set.id);
        if ("conflicts" in reverted)
          return json(409, {
            error: deps.explain(reverted.conflicts),
            conflicts: reverted.conflicts.length,
          });
        tell(set, false);
        return changeSetReply(set.id, { revert: reverted.id });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/review-link"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        await readJson(request, smallBody, emptyBody);
        return json(200, { url: (await changeSets.reviewLink(set.id)).href });
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/review-link/revoke"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        await readJson(request, smallBody, emptyBody);
        await changeSets.revokeReviewLink(set.id);
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
        const { problem } = await decide(
          body.changeSet,
          body.kind,
          { via: "review-link", token: body.token, by: body.name.trim() },
          body.hash,
          body.reason ?? null,
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
        const { warnings } = await changeSets.dismiss(
          body.changeSet as Ulid,
          { via: "review-link", token: body.token, by: body.name.trim() },
          body.hash,
        );
        const set = await mustChangeSet(body.changeSet);
        tell(set, false);
        return json(200, { changeSet: await viewOf(set), warnings });
      },
    },
  ];

  return async (request, url) => {
    const matched = routes.flatMap((route) => {
      const match = route.path.exec(url.pathname);
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
      if (error instanceof ThreadBusy || error instanceof ThreadLimit)
        return problem(409, error.message);
      if (error instanceof ActionError) return problem(actionStatus[error.code], error.message);
      const status = changeSetStatus(error);
      if (status !== null && error instanceof Error) return problem(status, error.message);
      deps.log("api: failed", { path: url.pathname, error: String(error) });
      throw error;
    }
  };
}
