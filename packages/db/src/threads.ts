// A thread's state is derived from what happened in it, never stored; only a done mark,
// which has no other record, is kept.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  type About,
  aboutValue,
  type Actor,
  actions,
  type Draft,
  type HeldSender,
  heldSender,
  heldText,
  type Instant,
  isInstant,
  orielNote,
  type OrielNote,
  isUlid,
  literal,
  nullable,
  optional,
  number,
  object,
  parseItemId,
  record,
  refine,
  string,
  type Thread,
  type Ulid,
  union,
  unknown,
} from "@oriel/core";
import { transaction } from "./open.ts";
import { dropWorkstream } from "./workstreams.ts";

const ulidValue = refine(string, isUlid, "expected a ULID");
const isDraftable = (name: string): name is Draft["action"] =>
  Object.hasOwn(actions, name) &&
  (actions as Record<string, { draftable?: true | "window" }>)[name]?.draftable !== undefined;
const instantValue = refine(string, isInstant, "expected an instant");
const threadRow = object({
  id: ulidValue,
  workspace_id: ulidValue,
  workstream_id: ulidValue,
  region_version: number,
  marked_done_at: nullable(instantValue),
  created_at: instantValue,
});
const atRow = object({ at: nullable(string) });
const titleRow = object({ title: string });
const appliedRow = object({ at: string, handed_off: number });
const idRow = object({ id: ulidValue });
const nextRow = object({ next: number });
const versionRow = object({ version: nullable(number) });
const messageRow = object({
  seq: number,
  role: union(
    literal("user"),
    literal("agent"),
    literal("marker"),
    literal("held"),
    literal("note"),
  ),
  content: string,
  at: instantValue,
});
// Rows written before migration 0003 hold a user's text as a bare JSON string.
const userContent = union(object({ text: string, about: optional(aboutValue) }), string);
const markerContent = object({ from: number, to: number });
const heldContent = union(
  refine(
    object({
      from: heldSender,
      text: string,
      outcome: nullable(union(literal("sent"), literal("discarded"))),
    }),
    (held) => heldText(held.from, held.text),
    "expected a held message within its sender's limit",
  ),
  object({
    draft: object({
      action: refine(string, isDraftable, "expected a draftable action"),
      input: record(unknown),
    }),
    over: unknown,
    outcome: nullable(union(literal("applied"), literal("discarded"))),
  }),
);
const workstreamMarkRow = object({ done_at: instantValue, done_by: string, threads: string });
const wroteRow = object({
  applied: number,
  reverted: number,
  unconfirmed: number,
  items: string,
});

export type NewMessage =
  | { role: "user"; text: string; about?: About }
  | { role: "agent"; event: unknown }
  | { role: "marker"; from: number; to: number }
  | { role: "note"; note: OrielNote }
  | { role: "held"; from: HeldSender; text: string }
  | { role: "held"; draft: Draft; over: unknown };

export type Held = { role: "held" } & (
  | { from: HeldSender; text: string; outcome: "sent" | "discarded" | null }
  | { draft: Draft; over: unknown; outcome: "applied" | "discarded" | null }
);

export type Message = (Exclude<NewMessage, { role: "held" }> | Held) & {
  seq: number;
  at: Instant;
};

export type Move = { threadId: Ulid; from: number; to: number; seq: number };

export type ThreadSummary = { thread: Thread; activityAt: Instant };

export type Wrote = { applied: number; reverted: number; unconfirmed: number; sources: string[] };

export type Deleted = { workstreamId: Ulid; kept: boolean; workstreamRemoved: boolean };

const live = `not exists (select 1 from deleted_threads d where d.thread_id = threads.id)
  and not exists (select 1 from deleted_workstreams w where w.workstream_id = threads.workstream_id)`;

const idleMs = 7 * 24 * 60 * 60 * 1000;

export type ThreadStore = ReturnType<typeof threadStore>;

export function threadStore(db: DatabaseSync) {
  const insert = db.prepare(`
    insert into threads (id, workspace_id, workstream_id, region_version, created_at)
    select ?, ?, workstream_id, max(version), ? from workstream_changes where workstream_id = ? group by workstream_id`);
  const select = db.prepare(`
    select id, workspace_id, workstream_id, region_version, marked_done_at, created_at
    from threads where id = ? and ${live}`);
  const mark = db.prepare(`update threads set marked_done_at = ? where id = ? and ${live}`);
  const markedBy = db.prepare(`
    insert into done_marks (workspace_id, thread_id, marked_by)
    select workspace_id, id, ?2 from threads where id = ?1
    on conflict (thread_id) do update set marked_by = excluded.marked_by`);
  const selectTitle = db.prepare("select title from thread_titles where thread_id = ?");
  const nameIt = db.prepare(`
    insert into thread_titles (thread_id, workspace_id, title, titled_at)
    select id, workspace_id, ?2, ?3 from threads where id = ?1
    on conflict (thread_id) do update set title = excluded.title, titled_at = excluded.titled_at`);
  const selectByWorkspace = db.prepare(`
    select id from threads where workspace_id = ? and ${live}
    order by created_at desc, id desc`);
  // Prepared on first use, so a store over a database migrated only part way still opens.
  let windowChats: Record<"newest" | "start" | "is" | "leave" | "forget", StatementSync> | null =
    null;
  const windowChat = () =>
    (windowChats ??= {
      newest: db.prepare(`
        select threads.id from window_chats c join threads on threads.id = c.thread_id
        where c.workspace_id = ? and c.left_at is null and ${live}
        order by threads.created_at desc, threads.id desc limit 1`),
      start: db.prepare(`
        insert into window_chats (thread_id, workspace_id)
        select id, workspace_id from threads where id = ?`),
      is: db.prepare("select 1 from window_chats where thread_id = ?"),
      leave: db.prepare(
        "update window_chats set left_at = ?2 where thread_id = ?1 and left_at is null",
      ),
      forget: db.prepare("delete from window_chats where thread_id = ?"),
    });
  const selectByWorkstream = db.prepare(`
    select id from threads where workstream_id = ? and ${live}
    order by created_at desc, id desc`);
  const selectLatest = db.prepare(
    "select max(version) as version from workstream_changes where workstream_id = ?",
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
  const lastMessage = db.prepare(
    "select max(at) as at from messages where thread_id = ? and role in ('user', 'held')",
  );
  const selectHeld = db.prepare(`
    select seq, role, content, at from messages
    where thread_id = ? and role = 'held' and json_extract(content, '$.outcome') is null
    order by seq`);
  const unmark = db.prepare(
    `update threads set marked_done_at = null
    where id = ?1 and marked_done_at is not null and (?2 is null or marked_done_at = ?2) and ${live}`,
  );
  const unmarkedBy = db.prepare("delete from done_marks where thread_id = ?");
  const rewriteAgent = db.prepare(
    "update messages set content = ?3 where thread_id = ?1 and seq = ?2 and role = 'agent'",
  );
  const settleHeld = db.prepare(`
    update messages set content = json_set(content, '$.outcome', ?3)
    where thread_id = ?1 and seq = ?2 and role = 'held'
      and json_extract(content, '$.outcome') is null
      and (?3 = 'discarded' or (?3 = 'applied') = (json_extract(content, '$.draft') is not null))`);
  const applyHeld = db.prepare(`
    update messages
    set content = json_set(content, '$.outcome', 'applied', '$.draft.input', json(?3))
    where thread_id = ?1 and seq = ?2 and role = 'held'
      and json_extract(content, '$.outcome') is null
      and json_extract(content, '$.draft') is not null`);
  const lastActivity = db.prepare(`
    select max(at) as at from (
      select created_at as at from threads where id = ?1
      union all select at from messages where thread_id = ?1 and role != 'marker'
      union all select created_at from change_sets where thread_id = ?1
      union all select d.at from decisions d join change_sets c on c.id = d.change_set_id
        where c.thread_id = ?1)`);
  // A row written without the change set engine has no completed_at: its last apply counts.
  const lastApplied = db.prepare(`
    select coalesce(c.completed_at, max(json_extract(m.applied, '$.at'))) as at,
      max(exists (
        select 1 from json_each(m.applied, '$.after') field
        where field.key = 'assignee' or (field.key like 'link:%' and field.type != 'null')
      )) as handed_off
    from change_sets c join mutations m on m.change_set_id = c.id
    where c.thread_id = ? group by c.id
    having count(*) = sum(m.status = 'applied')
    order by at desc, handed_off desc limit 1`);
  const selectAwaiting = db.prepare(`
    select 1 from change_sets c
    where c.thread_id = ?
      and exists (select 1 from mutations m where m.change_set_id = c.id and m.status != 'applied')
      and coalesce((
        select iif(d.undone_at is null, d.kind, 'open') from decisions d
        where d.change_set_id = c.id order by d.seq desc limit 1
      ), 'open') != 'rejected'
    limit 1`);

  // A row the engine left failed was sent with no answer, so it may have landed.
  const selectWrote = db.prepare(`
    select
      count(*) filter (where m.status = 'applied' and c.revert_of is null and not undone)
        as applied,
      count(*) filter (where m.status = 'applied' and c.revert_of is null and undone)
        as reverted,
      count(*) filter (where m.status = 'failed') as unconfirmed,
      json_group_array(distinct json_extract(m.applied, '$.item.id'))
        filter (where m.status = 'applied') as items
    from change_sets c join (
      select *, exists (
        select 1 from mutations r where r.reverts = mutations.id and r.status = 'applied'
      ) as undone from mutations
    ) m on m.change_set_id = c.id
    where c.thread_id = ?`);
  const selectChangeSets = db.prepare("select id from change_sets where thread_id = ?");
  const insertDeleted = db.prepare(
    "insert into deleted_threads (thread_id, workspace_id, deleted_at) values (?, ?, ?)",
  );
  const revokeLinks = db.prepare(`
    update review_links set revoked_at = ?2 where revoked_at is null
      and change_set_id in (select id from change_sets where thread_id = ?1)`);
  // Only for a thread that wrote nothing, so no revert anywhere names its change sets.
  const purge = [
    "delete from decisions where change_set_id in (select id from change_sets where thread_id = ?)",
    "delete from review_links where change_set_id in (select id from change_sets where thread_id = ?)",
    "delete from mutations where change_set_id in (select id from change_sets where thread_id = ?)",
    "delete from change_sets where thread_id = ?",
    "delete from run_reads where run_id in (select id from runs where thread_id = ?)",
    "delete from runs where thread_id = ?",
    "delete from messages where thread_id = ?",
    "delete from thread_titles where thread_id = ?",
    "delete from done_marks where thread_id = ?",
    "delete from threads where id = ?",
  ].map((sql) => db.prepare(sql));
  const selectEmptyWorkstream = db.prepare(`
    select g.id from workstreams g
    where g.id = ?1 and json_extract(g.origin, '$.kind') in ('thread', 'window')
      and not exists (select 1 from threads where workstream_id = ?1)
      and not exists (select 1 from workstream_members where workstream_id = ?1 and removed_version is null)`);
  const dropEmpty = dropWorkstream.map((sql) => db.prepare(sql));
  const selectWorkstreamMarks = db.prepare(
    "select done_at, done_by, threads from workstream_done_marks where workstream_id = ? order by done_at desc",
  );
  const markWorkstream = db.prepare(`
    insert into workstream_done_marks (workspace_id, workstream_id, done_at, done_by, threads)
    select workspace_id, id, ?2, ?3, ?4 from workstreams where id = ?1
    on conflict (workstream_id, done_at) do update set
      threads = (select json_group_array(value) from (
        select value from json_each(workstream_done_marks.threads)
        union select value from json_each(excluded.threads)))`);
  const unmarkWorkstream = db.prepare(
    "delete from workstream_done_marks where workstream_id = ?1 and (?2 is null or done_at = ?2)",
  );

  const wrote = (id: Ulid): Wrote => {
    const row = wroteRow(selectWrote.get(id));
    if (!row.ok) throw new Error(`corrupt mutations: ${JSON.stringify(row.issues)}`);
    const items: unknown = JSON.parse(row.value.items);
    const sources = (Array.isArray(items) ? items : []).flatMap((id) =>
      typeof id === "string" ? (parseItemId(id)?.prefix ?? []) : [],
    );
    return {
      applied: row.value.applied,
      reverted: row.value.reverted,
      unconfirmed: row.value.unconfirmed,
      sources: [...new Set(sources)],
    };
  };

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

  // The caller holds the transaction, so two appends can't take the same seq.
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
          ? message.about
            ? { text: message.text, about: message.about }
            : { text: message.text }
          : message.role === "held"
            ? "draft" in message
              ? { draft: message.draft, over: message.over, outcome: null }
              : { from: message.from, text: message.text, outcome: null }
            : message.role === "note"
              ? message.note
              : { from: message.from, to: message.to };
    if (message.role === "held" && !heldContent(content).ok)
      throw new RangeError(
        "a held message's sender or text is past its limits, or a draft isn't one",
      );
    const json = JSON.stringify(content);
    if (json === undefined) throw new TypeError("a message's content must be JSON");
    insertMessage.run(id, thread.workspace_id, thread.id, next.value.next, message.role, json, now);
    return next.value.next;
  };

  // The caller holds the transaction.
  const move = (id: Ulid, now: Instant, markerId: Ulid): Move | null => {
    const thread = mustLoad(id);
    const latest = versionRow(selectLatest.get(thread.workstream_id));
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
      if (typeof user.value === "string") return { seq, at: when, role, text: user.value };
      const { text, about } = user.value;
      return { seq, at: when, role, text, ...(about ? { about } : {}) };
    }
    if (role === "held") {
      const held = heldContent(content);
      if (!held.ok) throw new Error(`corrupt held message ${seq}`);
      return { seq, at: when, role, ...held.value };
    }
    if (role === "note") {
      const note = orielNote(content);
      if (!note.ok) throw new Error(`corrupt note ${seq}`);
      return { seq, at: when, role, note: note.value };
    }
    const marker = markerContent(content);
    if (!marker.ok) throw new Error(`corrupt marker ${seq}`);
    return { seq, at: when, role, from: marker.value.from, to: marker.value.to };
  };

  const get = (id: Ulid, now: Instant): Thread | null => {
    const row = load(id);
    if (!row) return null;
    const since = at(lastMessage, id);
    const appliedRaw = selectAwaiting.get(id) ? undefined : lastApplied.get(id);
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
      workstreamId: row.workstream_id,
      regionVersion: row.region_version,
      state: settled?.state ?? (idle ? "dropped" : "working"),
      doneBy: settled?.doneBy ?? null,
      createdAt: row.created_at,
    };
  };

  const workstreamMarks = (workstreamId: Ulid) =>
    selectWorkstreamMarks.all(workstreamId).map((raw) => {
      const row = workstreamMarkRow(raw);
      if (!row.ok)
        throw new Error(`corrupt workstream_done_marks row: ${JSON.stringify(row.issues)}`);
      const by: unknown = JSON.parse(row.value.done_by);
      const marked: unknown = JSON.parse(row.value.threads);
      return {
        at: row.value.done_at,
        by: (typeof by === "object" && by !== null && "kind" in by
          ? by.kind
          : "user") as Actor["kind"],
        threads: Array.isArray(marked) ? marked.filter((id): id is Ulid => isUlid(id)) : [],
      };
    });

  const workstreamDone = (workstreamId: Ulid, now: Instant) => {
    const [done] = workstreamMarks(workstreamId);
    if (!done) return null;
    const working = ids(selectByWorkstream.all(workstreamId)).some(
      (id) => get(id, now)?.state === "working",
    );
    return working ? null : { at: done.at, by: done.by };
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
    open(thread: { id: Ulid; workspaceId: Ulid; workstreamId: Ulid }, now: Instant): void {
      const { changes } = insert.run(thread.id, thread.workspaceId, now, thread.workstreamId);
      if (Number(changes) !== 1) throw new RangeError(`no workstream ${thread.workstreamId}`);
    },

    markDone(id: Ulid, now: Instant, by: Actor = { kind: "user" }): boolean {
      return transaction(db, () => {
        const thread = get(id, now);
        if (!thread) throw new RangeError(`no thread ${id}`);
        if (thread.state === "done" && thread.doneBy === "marked") return false;
        if (Number(mark.run(now, id).changes) !== 1) throw new RangeError(`no thread ${id}`);
        markedBy.run(id, JSON.stringify(by));
        return true;
      });
    },

    workstreamDone,

    markWorkstreamDone(
      workstreamId: Ulid,
      now: Instant,
      by: Actor = { kind: "user" },
    ): Ulid[] | null {
      return transaction(db, () => {
        if (workstreamDone(workstreamId, now)) return null;
        const marked = ids(selectByWorkstream.all(workstreamId)).filter((id) => {
          const state = get(id, now)?.state;
          if (state !== "working" && state !== "dropped") return false;
          mark.run(now, id);
          markedBy.run(id, JSON.stringify(by));
          return true;
        });
        const changes = markWorkstream.run(
          workstreamId,
          now,
          JSON.stringify(by),
          JSON.stringify(marked),
        ).changes;
        if (Number(changes) < 1) throw new RangeError(`no workstream ${workstreamId}`);
        return marked;
      });
    },

    reopenWorkstream(workstreamId: Ulid, at: Instant | null, now: Instant): Ulid[] | null {
      return transaction(db, () => {
        const marks = workstreamMarks(workstreamId);
        const taken = at === null ? marks : marks.slice(0, 1).filter((done) => done.at === at);
        if (taken.length === 0) return null;
        unmarkWorkstream.run(workstreamId, at);
        return taken.flatMap((done) =>
          done.threads.filter((id) => {
            const was = get(id, now);
            if (Number(unmark.run(id, done.at).changes) !== 1) return false;
            unmarkedBy.run(id);
            return was?.state === "done" && was.doneBy === "marked";
          }),
        );
      });
    },

    reopen(id: Ulid, at: Instant | null = null): boolean {
      return transaction(db, () => {
        if (Number(unmark.run(id, at).changes) !== 1) return false;
        unmarkedBy.run(id);
        return true;
      });
    },

    wrote(id: Ulid): Wrote {
      mustLoad(id);
      return wrote(id);
    },

    delete(id: Ulid, now: Instant, applying: (changeSetId: Ulid) => boolean): Deleted | null {
      return transaction(db, () => {
        const thread = mustLoad(id);
        if (ids(selectChangeSets.all(id)).some(applying)) return null;
        const { applied, reverted, unconfirmed } = wrote(id);
        if (applied > 0 || reverted > 0 || unconfirmed > 0) {
          insertDeleted.run(id, thread.workspace_id, now);
          revokeLinks.run(id, now);
          return { workstreamId: thread.workstream_id, kept: true, workstreamRemoved: false };
        }
        windowChat().forget.run(id);
        // Prepared here: a store may open on a database migrated only part way, as a migration's own test does.
        db.prepare("delete from challenges where thread_id = ?").run(id);
        for (const statement of purge) statement.run(id);
        const empty = selectEmptyWorkstream.get(thread.workstream_id) !== undefined;
        if (empty) for (const statement of dropEmpty) statement.run(thread.workstream_id);
        return { workstreamId: thread.workstream_id, kept: false, workstreamRemoved: empty };
      });
    },

    get,

    title(id: Ulid): string | null {
      const raw = selectTitle.get(id);
      if (!raw) return null;
      const row = titleRow(raw);
      if (!row.ok) throw new Error(`corrupt threads row: ${JSON.stringify(row.issues)}`);
      return row.value.title;
    },

    setTitle(id: Ulid, title: string, now: Instant): void {
      if (Number(nameIt.run(id, title, now).changes) !== 1) throw new RangeError(`no thread ${id}`);
    },

    windowChat(workspaceId: Ulid, now: Instant): Thread | null {
      const [id] = ids(windowChat().newest.all(workspaceId));
      const thread = id === undefined ? null : get(id, now);
      return thread?.state === "working" ? thread : null;
    },

    startWindowChat(id: Ulid): void {
      windowChat().start.run(id);
    },

    isWindowChat(id: Ulid): boolean {
      return windowChat().is.get(id) !== undefined;
    },

    leaveWindowChat(id: Ulid, now: Instant): void {
      windowChat().leave.run(id, now);
    },

    moveWindowChat(id: Ulid): void {
      windowChat().forget.run(id);
    },

    list(workspaceId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByWorkspace.all(workspaceId)).map((id) => summary(id, now));
    },

    ofWorkstream(workstreamId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByWorkstream.all(workstreamId)).map((id) => summary(id, now));
    },

    append(id: Ulid, message: NewMessage, messageId: Ulid, now: Instant): number {
      return transaction(db, () => append(mustLoad(id), message, messageId, now));
    },

    say(
      id: Ulid,
      text: string,
      ids: { marker: Ulid; message: Ulid },
      now: Instant,
      about?: (regionVersion: number, workstreamId: Ulid) => About | null,
    ): { move: Move | null; seq: number } {
      return transaction(db, () => {
        const moved = move(id, now, ids.marker);
        const thread = mustLoad(id);
        const what = about?.(thread.region_version, thread.workstream_id) ?? null;
        const message = what
          ? { role: "user" as const, text, about: what }
          : { role: "user" as const, text };
        return { move: moved, seq: append(thread, message, ids.message, now) };
      });
    },

    catchUp(id: Ulid, now: Instant, markerId: Ulid): Move | null {
      return transaction(db, () => move(id, now, markerId));
    },

    follow(workstreamId: Ulid, now: Instant, newId: () => Ulid): Move[] {
      return transaction(db, () =>
        ids(selectByWorkstream.all(workstreamId)).flatMap((id) => {
          if (get(id, now)?.state !== "working") return [];
          return move(id, now, newId()) ?? [];
        }),
      );
    },

    messages(id: Ulid, after = 0): Message[] {
      return selectMessages.all(id, after).map(message);
    },

    held(id: Ulid): (Held & { seq: number; at: Instant })[] {
      return selectHeld.all(id).flatMap((raw) => {
        const held = message(raw);
        return held.role === "held" ? [held] : [];
      });
    },

    rewrite(id: Ulid, seq: number, event: unknown): boolean {
      const json = JSON.stringify(event);
      if (json === undefined) throw new TypeError("a message's content must be JSON");
      return Number(rewriteAgent.run(id, seq, json).changes) === 1;
    },

    settle(id: Ulid, seq: number, outcome: "sent" | "discarded" | "applied"): boolean {
      return Number(settleHeld.run(id, seq, outcome).changes) === 1;
    },

    applied(id: Ulid, seq: number, input: Record<string, unknown>): boolean {
      return Number(applyHeld.run(id, seq, JSON.stringify(input)).changes) === 1;
    },
  };
}
