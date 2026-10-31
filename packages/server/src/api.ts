// The JSON routes. Every route is behind the Host/Origin guard (site.ts),
// which also refuses a request that changes state unless it carries this
// server's own Origin. On top of that, a POST must send JSON, within its
// route's size cap. GETs read; nothing a GET does opens, decides or writes.
import {
  array,
  type ChangeSet,
  type ChangeSets,
  type Cluster,
  type Conflict,
  type GroupMember,
  type IndexRecord,
  type Instant,
  isItemId,
  isUlid,
  type Log,
  literal,
  number,
  object,
  optional,
  parseItemId,
  refine,
  string,
  type TelemetryEvent,
  type Ulid,
  union,
  type Validator,
} from "@oriel/core";
import type { GroupStore, Message, ThreadStore } from "@oriel/db";
import {
  type DeletedView,
  type DeletionView,
  type FolderView,
  type GroupingId,
  isGroupingId,
  type JiraView,
  type StreamEvent,
} from "@oriel/web/view";
import { resolveDropped } from "./dropped.ts";
import type { Reply, Request } from "./site.ts";
import { channel } from "./stream.ts";
import { ThreadBusy, ThreadLimit, type Turns } from "./turns.ts";
import { changeSetView, memberOf, type Views } from "./views.ts";

export type ApiDeps = {
  workspaceId: Ulid;
  groups: GroupStore;
  threads: ThreadStore;
  // The index's live records, from every source.
  records(): readonly IndexRecord[];
  // A grouping's clusters as the window shows them now.
  clusters(grouping: GroupingId): Cluster[];
  changeSets: ChangeSets;
  turns: Turns;
  views: Views;
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
export const maxNameChars = 120;
const maxItems = 500;

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
const problem = (status: number, error: string): Reply => json(status, { error });

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
const itemList = refine(
  array(itemIdValue),
  (items) => items.length > 0 && items.length <= maxItems,
  `expected 1 to ${maxItems} items`,
);

const newGroup = union(
  object({
    kind: literal("cluster"),
    grouping: refine(string, isGroupingId, "expected epic, assignee or stuck"),
    cluster: string,
  }),
  object({ kind: literal("picked"), name: nameValue, items: itemList }),
);
const itemsBody = object({ items: itemList });
const maxDropped = 50;
const droppedFile = object({
  name: refine(string, (name) => name.length <= 255, "expected at most 255 characters"),
  modified: number,
});
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
const renameBody = object({ name: nameValue });
// What a group made for a thread from nothing is called, until a change set
// creates its epic and it takes that epic's name.
export const blankGroupName = "New group";
const openThreadBody = object({ text: optional(textValue) });
const messageBodyValue = object({ text: textValue });
const hashBody = object({ hash: string });
const editBody = object({
  remove: refine(array(ulidValue), (ids) => ids.length > 0, "nothing to remove"),
});
const tokenBody = object({ token: string });
const reviewDecision = object({
  token: string,
  changeSet: ulidValue,
  kind: union(literal("approved"), literal("rejected")),
  name: nameValue,
  hash: string,
});
const reviewDismissal = object({
  token: string,
  changeSet: ulidValue,
  name: nameValue,
  hash: string,
});
const emptyBody = object({});
// Where the user closed a thread from.
const closeBody = object({ via: optional(union(literal("page"), literal("menu"))) });
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
const at = (path: string) => new RegExp(`^/api${path.replaceAll(":id", ulidPart)}$`);

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

  // Items as the index has them now; one it doesn't have is refused.
  const indexed = (ids: readonly string[]): GroupMember[] => {
    const byId = new Map(deps.records().map((r) => [r.id, r]));
    return ids.map((id) => {
      const record = byId.get(id as IndexRecord["id"]);
      if (!record) throw new Refused(400, `${id} isn't in the window`);
      return { id: record.id, stableId: record.stableId };
    });
  };

  // Adds items as the user, with an event for each new one; their IDs.
  const addMembers = (groupId: Ulid, members: GroupMember[]): string[] => {
    if (members.length === 0) return [];
    const now = deps.now();
    const change = groups.add(groupId, members, { kind: "user" }, now);
    for (const member of change?.added ?? [])
      deps.emit({
        name: "group.item-added",
        at: now,
        workspaceId: deps.workspaceId,
        groupId,
        source: parseItemId(member.id)?.source ?? "jira",
        cause: "user",
      });
    if (change) follow(groupId);
    return (change?.added ?? []).map((member) => member.id);
  };

  // After a group changed: its working threads follow it, with markers.
  const follow = (groupId: Ulid) => turns.moved(threads.follow(groupId, deps.now(), deps.newId));

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
  // write, so replay follows it (decision 0003).
  const decide = async (
    id: Ulid,
    kind: "approved" | "rejected",
    approver: Parameters<ChangeSets["decide"]>[2],
    hash: string,
  ) => {
    const decided = await changeSets.decide(id, kind, approver, hash);
    if (kind === "rejected") {
      tell(decided, false);
      return { report: null, problem: null };
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
      else if (event.type === "deleted") {
        send({ type: "deleted" });
        out.end();
      } else status();
    });
    // A thread's page hears other threads move on this stream too, so a tab
    // holds one stream at most: browsers allow few per host. Its own thread's
    // moves are the status and change-set events above.
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

  // The workspace's threads moved: one empty event each time, which pages
  // answer by reloading the threads list.
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
      // What only the window knows happened. Two events, fixed fields.
      method: "POST",
      path: at("/telemetry"),
      async run(_, request) {
        const event = await readJson(request, tinyBody, windowEvent);
        const at = deps.now();
        const { workspaceId } = deps;
        deps.emit(
          event.name === "grouping.switched"
            ? { name: event.name, at, workspaceId, grouping: event.grouping }
            : { name: event.name, at, workspaceId, from: event.from, to: event.to },
        );
        return json(202, {});
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
        const body = await readJson(request, listBody, newGroup);
        const now = deps.now();
        const id = deps.newId();
        if (body.kind === "cluster") {
          const cluster = deps.clusters(body.grouping).find((c) => c.key === body.cluster);
          if (!cluster) throw new Refused(404, "no such cluster in that grouping");
          const ids =
            cluster.anchor === null ? cluster.itemIds : [cluster.anchor, ...cluster.itemIds];
          const byId = new Map(deps.records().map((r) => [r.id, r]));
          const members = [...new Set(ids)].flatMap((item) => {
            const record = byId.get(item);
            return record ? [{ id: record.id, stableId: record.stableId }] : [];
          });
          const anchor = cluster.anchor === null ? null : byId.get(cluster.anchor);
          groups.create(
            {
              id,
              workspaceId: deps.workspaceId,
              name: cluster.label.slice(0, maxNameChars) || "Untitled",
              origin: {
                kind: "cluster",
                grouping: body.grouping,
                cluster: cluster.key,
                anchor: anchor ? { id: anchor.id, stableId: anchor.stableId } : null,
              },
            },
            members,
            now,
          );
          deps.emit({
            name: "group.created",
            at: now,
            workspaceId: deps.workspaceId,
            groupId: id,
            origin: "cluster",
            size: members.length,
          });
        } else {
          const members = indexed(body.items);
          groups.create(
            {
              id,
              workspaceId: deps.workspaceId,
              name: body.name.trim(),
              origin: { kind: "picked" },
            },
            members,
            now,
          );
          deps.emit({
            name: "group.created",
            at: now,
            workspaceId: deps.workspaceId,
            groupId: id,
            origin: "picked",
            size: new Set(members.map((m) => `${m.id}`)).size,
          });
        }
        return json(201, views.groupSummary(id));
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
        const group = mustGroup(id);
        addMembers(group.id, indexed((await readJson(request, listBody, itemsBody)).items));
        return json(200, await views.group(group.id));
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
        let resolved = resolveDropped(deps.records(), dropped);
        let synced: string | null = null;
        if (resolved.refused.some((refusal) => refusal.syncMightHelp)) {
          synced = await deps.refresh();
          resolved = resolveDropped(deps.records(), dropped);
        }
        if (resolved.ids.length > maxItems)
          throw new Refused(400, `expected at most ${maxItems} items`);
        const added = addMembers(group.id, indexed(resolved.ids));
        const refused = resolved.refused.map(({ what, why, syncMightHelp }) => ({
          what,
          why: synced && syncMightHelp ? `${why} ${synced}` : why,
        }));
        return json(200, { group: await views.group(group.id), added, refused });
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/remove"),
      async run([id = ""], request) {
        const group = mustGroup(id);
        const { items } = await readJson(request, listBody, itemsBody);
        // By identity: a moved item is removed under its current handle, and
        // one the index no longer has under the handle the group shows.
        const held = groups.region(group.id, group.version)?.items ?? [];
        const records = deps.records();
        const members = items.map((item) => {
          const member = memberOf(item, held, records);
          if (!member) throw new Refused(400, `${item} isn't in this group`);
          return member;
        });
        if (groups.remove(group.id, members, { kind: "user" }, deps.now())) follow(group.id);
        return json(200, await views.group(group.id));
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/rename"),
      async run([id = ""], request) {
        const group = mustGroup(id);
        const { name } = await readJson(request, smallBody, renameBody);
        groups.rename(group.id, name.trim());
        return json(200, views.groupSummary(group.id));
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
      run: async () => json(200, { threads: await views.inbox(deps.workspaceId) }),
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
        const now = deps.now();
        const groupId = deps.newId();
        const group = groups.create(
          {
            id: groupId,
            workspaceId: deps.workspaceId,
            name: blankGroupName,
            origin: { kind: "thread" },
          },
          [],
          now,
        );
        deps.emit({
          name: "group.created",
          at: now,
          workspaceId: deps.workspaceId,
          groupId,
          origin: "thread",
          size: 0,
        });
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
        const { via } = await readJson(request, smallBody, closeBody);
        const thread = mustThread(id);
        const now = deps.now();
        threads.markDone(thread.id, now);
        turns.touched(thread.id);
        deps.emit({
          name: "thread.marked-done",
          at: now,
          workspaceId: deps.workspaceId,
          threadId: thread.id,
          via: via ?? "page",
        });
        return json(200, await threadView(thread.id));
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
        const { hash } = await readJson(request, smallBody, hashBody);
        await decide(set.id, "rejected", { via: "thread", by: "user" }, hash);
        return changeSetReply(set.id);
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
        const body = await readJson(request, smallBody, reviewDecision);
        // The decision checks that the token is live for this change set.
        const { problem } = await decide(
          body.changeSet,
          body.kind,
          { via: "review-link", token: body.token, by: body.name.trim() },
          body.hash,
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
      const status = changeSetStatus(error);
      if (status !== null && error instanceof Error) return problem(status, error.message);
      deps.log("api: failed", { path: url.pathname, error: String(error) });
      throw error;
    }
  };
}
