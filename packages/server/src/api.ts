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
import { type GroupingId, isGroupingId, type StreamEvent } from "@oriel/web/view";
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
  // Revert conflicts in plain words.
  explain(conflicts: readonly Conflict[]): string;
  log: Log;
};

// Body caps, in bytes.
const smallBody = 4 * 1024;
const listBody = 64 * 1024;
const messageBody = 32 * 1024;
const maxMessageChars = 8_000;
const maxNameChars = 120;
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
const renameBody = object({ name: nameValue });
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
const emptyBody = object({});
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
  const mustThread = (id: string) => {
    const thread = threads.get(id as Ulid, deps.now());
    if (!thread || thread.workspaceId !== deps.workspaceId)
      throw new Refused(404, "no such thread");
    return thread;
  };
  const mustChangeSet = async (id: string) => {
    const set = await changeSets.get(id as Ulid);
    if (!set || set.workspaceId !== deps.workspaceId) throw new Refused(404, "no such change set");
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

  // After a group changed: its working threads follow it, with markers.
  const follow = (groupId: Ulid) => turns.moved(threads.follow(groupId, deps.now(), deps.newId));

  const changeSetReply = async (id: Ulid, extra: Record<string, unknown> = {}) => {
    const set = await mustChangeSet(id);
    const all = await changeSets.ofThread(set.threadId);
    return json(200, { changeSet: changeSetView(set, all), ...extra });
  };

  // Decides, and on approval applies at once: approving is what lets Oriel
  // write, so replay follows it (decision 0003).
  const decide = async (
    id: Ulid,
    kind: "approved" | "rejected",
    approver: Parameters<ChangeSets["decide"]>[2],
    hash: string,
  ) => {
    await changeSets.decide(id, kind, approver, hash);
    if (kind === "rejected") return { report: null, problem: null };
    // The decision stands even if applying it is refused (another apply is
    // under way, say): the change set says where it stands, and why.
    try {
      const report = await changeSets.apply(id);
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
    const stop = turns.watch(threadId, (event) =>
      event.type === "message" ? entry(event.message) : status(),
    );
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

  const routes: Route[] = [
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
        return json(200, views.group(id as Ulid));
      },
    },
    {
      method: "POST",
      path: at("/groups/:id/add"),
      async run([id = ""], request) {
        const group = mustGroup(id);
        const members = indexed((await readJson(request, listBody, itemsBody)).items);
        const now = deps.now();
        const change = groups.add(group.id, members, { kind: "user" }, now);
        for (const member of change?.added ?? [])
          deps.emit({
            name: "group.item-added",
            at: now,
            workspaceId: deps.workspaceId,
            groupId: group.id,
            source: parseItemId(member.id)?.source ?? "jira",
            cause: "user",
          });
        if (change) follow(group.id);
        return json(200, views.group(group.id));
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
        return json(200, views.group(group.id));
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
        const threadId = deps.newId();
        const now = deps.now();
        threads.open({ id: threadId, workspaceId: deps.workspaceId, groupId: group.id }, now);
        deps.emit({
          name: "thread.opened",
          at: now,
          workspaceId: deps.workspaceId,
          threadId,
          groupId: group.id,
          regionSize: groups.region(group.id, group.version)?.items.length ?? 0,
        });
        if (text !== undefined) turns.say(threadId, text);
        return json(201, { id: threadId });
      },
    },
    {
      method: "GET",
      path: at("/threads"),
      run: async () => json(200, { threads: views.inbox(deps.workspaceId) }),
    },
    {
      method: "GET",
      path: at("/threads/:id"),
      async run([id = ""]) {
        const thread = mustThread(id);
        return json(200, views.thread(thread.id, await changeSets.ofThread(thread.id)));
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
        const thread = mustThread(id);
        await readJson(request, smallBody, emptyBody);
        const now = deps.now();
        threads.markDone(thread.id, now);
        deps.emit({
          name: "thread.marked-done",
          at: now,
          workspaceId: deps.workspaceId,
          threadId: thread.id,
        });
        return json(200, views.thread(thread.id, await changeSets.ofThread(thread.id)));
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
        return json(200, views.diff(diff, set));
      },
    },
    {
      method: "POST",
      path: at("/change-sets/:id/edit"),
      async run([id = ""], request) {
        const set = await mustChangeSet(id);
        const { remove } = await readJson(request, smallBody, editBody);
        await changeSets.edit(set.id, { remove });
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
        const report = await changeSets.apply(set.id);
        await deps.applied(await mustChangeSet(set.id));
        return changeSetReply(set.id, { report });
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
        const all = await changeSets.ofThread(opened.changeSet.threadId);
        return json(200, {
          changeSet: changeSetView(opened.changeSet, all),
          diff: views.diff(opened.diff, opened.changeSet),
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
          changeSet: changeSetView(set, await changeSets.ofThread(set.threadId)),
          problem,
        });
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
