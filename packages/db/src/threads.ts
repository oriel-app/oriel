// Threads, their chat and their states (SPEC §1.3, decision 0018). A
// thread's state is derived from what happened in it, never stored; only the
// user marking it done has no other record, so that time is kept. `now` is
// passed in.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  literal,
  nullable,
  number,
  object,
  refine,
  string,
  type Thread,
  type Ulid,
  union,
} from "@oriel/core";
import { transaction } from "./open.ts";

const ulidValue = refine(string, isUlid, "expected a ULID");
const instantValue = refine(string, isInstant, "expected an instant");
const threadRow = object({
  id: ulidValue,
  workspace_id: ulidValue,
  group_id: ulidValue,
  region_version: number,
  marked_done_at: nullable(instantValue),
  created_at: instantValue,
});
const atRow = object({ at: nullable(string) });
const appliedRow = object({ at: string, handed_off: number });
const idRow = object({ id: ulidValue });
const nextRow = object({ next: number });
const versionRow = object({ version: nullable(number) });
const messageRow = object({
  seq: number,
  role: union(literal("user"), literal("agent"), literal("marker")),
  content: string,
  at: instantValue,
});
// Rows written before 0003 hold a user's text as a bare JSON string.
const userContent = union(object({ text: string }), string);
const markerContent = object({ from: number, to: number });

// What can be added to a thread's chat. The agent's entries are its events
// as the server receives them; the server checks their shape on the way out.
// A marker says the thread moved from one version of its group to a later
// one; what changed between them is in the group's own log, so it isn't
// copied here.
export type NewMessage =
  | { role: "user"; text: string }
  | { role: "agent"; event: unknown }
  | { role: "marker"; from: number; to: number };

// One entry in a thread's chat. `seq` orders the chat.
export type Message = NewMessage & { seq: number; at: Instant };

// A thread that moved to a newer version of its group, and its marker's seq.
export type Move = { threadId: Ulid; from: number; to: number; seq: number };

// A thread with the time anything last happened in it, markers aside.
export type ThreadSummary = { thread: Thread; activityAt: Instant };

// A working thread with no activity this long is dropped.
const idleMs = 7 * 24 * 60 * 60 * 1000;

export type ThreadStore = ReturnType<typeof threadStore>;

export function threadStore(db: DatabaseSync) {
  const insert = db.prepare(`
    insert into threads (id, workspace_id, group_id, region_version, created_at)
    select ?, ?, group_id, max(version), ? from group_changes where group_id = ? group by group_id`);
  const select = db.prepare(`
    select id, workspace_id, group_id, region_version, marked_done_at, created_at
    from threads where id = ?`);
  const mark = db.prepare("update threads set marked_done_at = ? where id = ?");
  const selectByWorkspace = db.prepare(
    "select id from threads where workspace_id = ? order by created_at desc, id desc",
  );
  const selectByGroup = db.prepare(
    "select id from threads where group_id = ? order by created_at desc, id desc",
  );
  const selectLatest = db.prepare(
    "select max(version) as version from group_changes where group_id = ?",
  );
  const moveTo = db.prepare("update threads set region_version = ? where id = ?");
  const nextSeq = db.prepare(
    "select coalesce(max(seq), 0) + 1 as next from messages where thread_id = ?",
  );
  const insertMessage = db.prepare(`
    insert into messages (id, workspace_id, thread_id, seq, role, content, at)
    values (?, ?, ?, ?, ?, ?, ?)`);
  const selectMessages = db.prepare(
    "select seq, role, content, at from messages where thread_id = ? and seq > ? order by seq",
  );
  // The person's latest message: a new one makes a settled thread working again.
  const lastMessage = db.prepare(
    "select max(at) as at from messages where thread_id = ? and role = 'user'",
  );
  // Anything that happened in the thread, for the idle rule. A marker alone
  // isn't activity (decision 0018).
  const lastActivity = db.prepare(`
    select max(at) as at from (
      select created_at as at from threads where id = ?1
      union all select at from messages where thread_id = ?1 and role != 'marker'
      union all select created_at from change_sets where thread_id = ?1
      union all select d.at from decisions d join change_sets c on c.id = d.change_set_id
        where c.thread_id = ?1)`);
  // The change set last applied in full, at the time it completed (its last
  // mutation's), and whether it handed the work off: any of its mutations
  // set an assignee or attached a link, in core's field names
  // (`FieldValues`). A set only partly applied settles nothing.
  const lastApplied = db.prepare(`
    select max(json_extract(m.applied, '$.at')) as at,
      max(exists (
        select 1 from json_each(m.applied, '$.after') field
        where field.key = 'assignee' or (field.key like 'link:%' and field.type != 'null')
      )) as handed_off
    from change_sets c join mutations m on m.change_set_id = c.id
    where c.thread_id = ? group by c.id
    having count(*) = sum(m.status = 'applied')
    order by at desc, handed_off desc limit 1`);

  const at = (statement: ReturnType<DatabaseSync["prepare"]>, id: Ulid): string | null => {
    const row = atRow(statement.get(id));
    return row.ok ? row.value.at : null;
  };

  const ids = (rows: unknown[]): Ulid[] =>
    rows.map((raw) => {
      const row = idRow(raw);
      if (!row.ok) throw new Error(`corrupt threads row: ${JSON.stringify(row.issues)}`);
      return row.value.id;
    });

  const load = (id: Ulid) => {
    const raw = select.get(id);
    if (!raw) return null;
    const parsed = threadRow(raw);
    if (!parsed.ok) throw new Error(`corrupt threads row: ${JSON.stringify(parsed.issues)}`);
    return parsed.value;
  };

  const mustLoad = (id: Ulid) => {
    const found = load(id);
    if (!found) throw new RangeError(`no thread ${id}`);
    return found;
  };

  // Appends to the chat and returns the entry's seq. The caller holds the
  // transaction, so two appends can't take the same seq.
  const append = (
    thread: { id: Ulid; workspace_id: Ulid },
    message: NewMessage,
    id: Ulid,
    now: Instant,
  ): number => {
    const next = nextRow(nextSeq.get(thread.id));
    if (!next.ok) throw new Error("corrupt messages sequence");
    const content =
      message.role === "agent"
        ? message.event
        : message.role === "user"
          ? { text: message.text }
          : { from: message.from, to: message.to };
    const json = JSON.stringify(content);
    if (json === undefined) throw new TypeError("a message's content must be JSON");
    insertMessage.run(id, thread.workspace_id, thread.id, next.value.next, message.role, json, now);
    return next.value.next;
  };

  // Moves a thread to its group's latest version, with a marker, if it is
  // behind. The caller holds the transaction.
  const move = (id: Ulid, now: Instant, markerId: Ulid): Move | null => {
    const thread = mustLoad(id);
    const latest = versionRow(selectLatest.get(thread.group_id));
    const to = latest.ok ? latest.value.version : null;
    if (to === null || to <= thread.region_version) return null;
    moveTo.run(to, id);
    const from = thread.region_version;
    return {
      threadId: id,
      from,
      to,
      seq: append(thread, { role: "marker", from, to }, markerId, now),
    };
  };

  const message = (raw: unknown): Message => {
    const row = messageRow(raw);
    if (!row.ok) throw new Error(`corrupt messages row: ${JSON.stringify(row.issues)}`);
    const { seq, role, at: when } = row.value;
    const content: unknown = JSON.parse(row.value.content);
    if (role === "agent") return { seq, at: when, role, event: content };
    if (role === "user") {
      const user = userContent(content);
      if (!user.ok) throw new Error(`corrupt user message ${seq}`);
      return {
        seq,
        at: when,
        role,
        text: typeof user.value === "string" ? user.value : user.value.text,
      };
    }
    const marker = markerContent(content);
    if (!marker.ok) throw new Error(`corrupt marker ${seq}`);
    return { seq, at: when, role, from: marker.value.from, to: marker.value.to };
  };

  // The thread as of `now`. Done (a change set applied in full, or the
  // user's mark), handed off (an applied assignee change or attached link)
  // or, failing those, dropped after 7 idle days; anything else is working.
  // A message from the person after it settled makes it working again; of
  // two settlings, the later counts.
  const get = (id: Ulid, now: Instant): Thread | null => {
    const row = load(id);
    if (!row) return null;
    const since = at(lastMessage, id);
    const appliedRaw = lastApplied.get(id);
    const applied = appliedRaw ? appliedRow(appliedRaw) : null;
    const set = applied?.ok ? applied.value : null;
    const settled = [
      {
        state: "handed-off" as const,
        doneBy: null,
        at: set?.handed_off ? set.at : null,
      },
      { state: "done" as const, doneBy: "marked" as const, at: row.marked_done_at },
      {
        state: "done" as const,
        doneBy: "applied" as const,
        at: set && !set.handed_off ? set.at : null,
      },
    ]
      .filter(
        (s): s is typeof s & { at: string } => s.at !== null && (since === null || s.at > since),
      )
      // Latest first; on a tie, the order above.
      .toSorted((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))[0];
    const activity = at(lastActivity, id) ?? row.created_at;
    const idle = Date.parse(now) - Date.parse(activity) >= idleMs;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      groupId: row.group_id,
      regionVersion: row.region_version,
      state: settled?.state ?? (idle ? "dropped" : "working"),
      doneBy: settled?.doneBy ?? null,
      createdAt: row.created_at,
    };
  };

  const summary = (id: Ulid, now: Instant): ThreadSummary => {
    const thread = get(id, now);
    if (!thread) throw new RangeError(`no thread ${id}`);
    const activity = at(lastActivity, id);
    return {
      thread,
      activityAt: activity !== null && isInstant(activity) ? activity : thread.createdAt,
    };
  };

  return {
    // A new thread on a group, working in the group's latest version.
    open(thread: { id: Ulid; workspaceId: Ulid; groupId: Ulid }, now: Instant): void {
      const { changes } = insert.run(thread.id, thread.workspaceId, now, thread.groupId);
      if (Number(changes) !== 1) throw new RangeError(`no group ${thread.groupId}`);
    },

    // The user marks the thread done, as one over read-only items needs to.
    markDone(id: Ulid, now: Instant): void {
      if (Number(mark.run(now, id).changes) !== 1) throw new RangeError(`no thread ${id}`);
    },

    get,

    // A workspace's threads, newest first, with their latest activity.
    list(workspaceId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByWorkspace.all(workspaceId)).map((id) => summary(id, now));
    },

    // A group's threads, newest first.
    ofGroup(groupId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByGroup.all(groupId)).map((id) => summary(id, now));
    },

    // Adds to the chat; returns the entry's seq.
    append(id: Ulid, message: NewMessage, messageId: Ulid, now: Instant): number {
      return transaction(db, () => append(mustLoad(id), message, messageId, now));
    },

    // The person's message. A thread behind its group (one that settled, or
    // was dropped, while the group changed) first catches up, with a marker,
    // so the message is about the group as it is now (decision 0018).
    say(
      id: Ulid,
      text: string,
      ids: { marker: Ulid; message: Ulid },
      now: Instant,
    ): { move: Move | null; seq: number } {
      return transaction(db, () => {
        const moved = move(id, now, ids.marker);
        return {
          move: moved,
          seq: append(mustLoad(id), { role: "user", text }, ids.message, now),
        };
      });
    },

    // After the group changed: each of its working threads moves to the
    // latest version, with a marker. Settled and dropped ones keep theirs
    // until a new message. `newId` names each marker.
    follow(groupId: Ulid, now: Instant, newId: () => Ulid): Move[] {
      return transaction(db, () =>
        ids(selectByGroup.all(groupId)).flatMap((id) => {
          if (get(id, now)?.state !== "working") return [];
          return move(id, now, newId()) ?? [];
        }),
      );
    },

    // The chat after `after`, oldest first.
    messages(id: Ulid, after = 0): Message[] {
      return selectMessages.all(id, after).map(message);
    },
  };
}
