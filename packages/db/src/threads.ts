// Threads, their chat and their states (SPEC §1.3, decision 0018). A
// thread's state is derived from what happened in it, never stored; only
// marking it done has no other record, so that time is kept, and who did it.
// `now` is passed in.
import type { DatabaseSync } from "node:sqlite";
import {
  type Actor,
  type HeldSender,
  heldSender,
  heldText,
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
import { dropWorkstream } from "./workstreams.ts";

const ulidValue = refine(string, isUlid, "expected a ULID");
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
  role: union(literal("user"), literal("agent"), literal("marker"), literal("held")),
  content: string,
  at: instantValue,
});
// Rows written before 0003 hold a user's text as a bare JSON string.
const userContent = union(object({ text: string }), string);
const markerContent = object({ from: number, to: number });
// A held message, who it is from, and its text within that sender's limit.
const heldContent = refine(
  object({
    from: heldSender,
    text: string,
    outcome: nullable(union(literal("sent"), literal("discarded"))),
  }),
  (held) => heldText(held.from, held.text),
  "expected a held message within its sender's limit",
);
const wroteRow = object({
  applied: number,
  reverted: number,
  unconfirmed: number,
  sources: string,
});

// What can be added to a thread's chat. The agent's entries are its events
// as the server receives them; the server checks their shape on the way out.
// A marker says the thread moved from one version of its workstream to a later
// one; what changed between them is in the workstream's own log, so it isn't
// copied here. A held entry is a message from anyone but the user, which
// waits for them (decision 0024).
export type NewMessage =
  | { role: "user"; text: string }
  | { role: "agent"; event: unknown }
  | { role: "marker"; from: number; to: number }
  | Omit<Held, "outcome">;

// A held message, who it is from, and what the user did with it: sent it to
// the agent, as it was or edited, or discarded it. Null while it waits on
// them.
export type Held = {
  role: "held";
  from: HeldSender;
  text: string;
  outcome: "sent" | "discarded" | null;
};

// One entry in a thread's chat. `seq` orders the chat.
export type Message = (Exclude<NewMessage, { role: "held" }> | Held) & {
  seq: number;
  at: Instant;
};

// A thread that moved to a newer version of its workstream, and its marker's seq.
export type Move = { threadId: Ulid; from: number; to: number; seq: number };

// A thread with the time anything last happened in it, markers aside.
export type ThreadSummary = { thread: Thread; activityAt: Instant };

// What a thread's change sets did to its sources: the changes that landed
// and still stand, those a revert since undid, those sent with no answer,
// which may have landed, and the sources anything landed in.
export type Wrote = { applied: number; reverted: number; unconfirmed: number; sources: string[] };

// A deleted thread: `kept` when it wrote to a source, so its records stay
// out of sight; `workstreamRemoved` when its workstream went with it.
export type Deleted = { workstreamId: Ulid; kept: boolean; workstreamRemoved: boolean };

// A thread the user deleted is gone from every list and lookup; one kept for
// what it wrote is in deleted_threads.
const live = "not exists (select 1 from deleted_threads d where d.thread_id = threads.id)";

// A working thread with no activity this long is dropped.
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
  // The user's latest message, or one held for them: either makes a settled
  // thread working again, the second because it waits on them.
  const lastMessage = db.prepare(
    "select max(at) as at from messages where thread_id = ? and role in ('user', 'held')",
  );
  // Held messages the user hasn't sent or discarded yet.
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
      and json_extract(content, '$.outcome') is null`);
  // Anything that happened in the thread, for the idle rule. A marker alone
  // isn't activity (decision 0018).
  const lastActivity = db.prepare(`
    select max(at) as at from (
      select created_at as at from threads where id = ?1
      union all select at from messages where thread_id = ?1 and role != 'marker'
      union all select created_at from change_sets where thread_id = ?1
      union all select d.at from decisions d join change_sets c on c.id = d.change_set_id
        where c.thread_id = ?1)`);
  // The change set last applied in full, at the time it completed, and
  // whether it handed the work off: any of its mutations set an assignee or
  // attached a link, in core's field names (`FieldValues`). A set only partly
  // applied settles nothing. Completion is when the set's last change
  // applied by whichever path, an edit or a revert included, as the change
  // set engine records it; for a row written without it, its last apply.
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

  // What the thread's change sets did to a source. A change that landed
  // counts as reverted once an applied reverse mutation undid it; a revert's
  // own changes count as nothing more. A row the engine left failed was sent
  // with no answer, so it may have landed: a refusal before sending puts it
  // back to pending. Sources are where anything landed.
  const selectWrote = db.prepare(`
    select
      count(*) filter (where m.status = 'applied' and c.revert_of is null and not undone)
        as applied,
      count(*) filter (where m.status = 'applied' and c.revert_of is null and undone)
        as reverted,
      count(*) filter (where m.status = 'failed') as unconfirmed,
      json_group_array(distinct substr(json_extract(m.applied, '$.item.id'), 1,
        instr(json_extract(m.applied, '$.item.id'), ':') - 1))
        filter (where m.status = 'applied') as sources
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
  // A kept thread's change sets can't be reviewed from anywhere.
  const revokeLinks = db.prepare(`
    update review_links set revoked_at = ?2 where revoked_at is null
      and change_set_id in (select id from change_sets where thread_id = ?1)`);
  // Everything a thread holds, children first. Only a thread that wrote
  // nothing goes this way, so no revert anywhere names its change sets.
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
  // A workstream made for a thread from nothing, once it holds no thread, kept or
  // not, and no item, as when its one thread was abandoned.
  const selectEmptyWorkstream = db.prepare(`
    select g.id from workstreams g
    where g.id = ?1 and json_extract(g.origin, '$.kind') = 'thread'
      and not exists (select 1 from threads where workstream_id = ?1)
      and not exists (select 1 from workstream_members where workstream_id = ?1 and removed_version is null)`);
  const dropEmpty = dropWorkstream.map((sql) => db.prepare(sql));

  const wrote = (id: Ulid): Wrote => {
    const row = wroteRow(selectWrote.get(id));
    if (!row.ok) throw new Error(`corrupt mutations: ${JSON.stringify(row.issues)}`);
    const sources: unknown = JSON.parse(row.value.sources);
    return {
      applied: row.value.applied,
      reverted: row.value.reverted,
      unconfirmed: row.value.unconfirmed,
      sources: Array.isArray(sources)
        ? sources.filter((s): s is string => typeof s === "string" && s !== "")
        : [],
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
          : message.role === "held"
            ? { from: message.from, text: message.text, outcome: null }
            : { from: message.from, to: message.to };
    if (message.role === "held" && !heldContent(content).ok)
      throw new RangeError("a held message's sender or text is past its limits");
    const json = JSON.stringify(content);
    if (json === undefined) throw new TypeError("a message's content must be JSON");
    insertMessage.run(id, thread.workspace_id, thread.id, next.value.next, message.role, json, now);
    return next.value.next;
  };

  // Moves a thread to its workstream's latest version, with a marker, if it is
  // behind. The caller holds the transaction.
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
      return {
        seq,
        at: when,
        role,
        text: typeof user.value === "string" ? user.value : user.value.text,
      };
    }
    if (role === "held") {
      const held = heldContent(content);
      if (!held.ok) throw new Error(`corrupt held message ${seq}`);
      return { seq, at: when, role, ...held.value };
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
      workstreamId: row.workstream_id,
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
    // A new thread on a workstream, working in the workstream's latest version.
    open(thread: { id: Ulid; workspaceId: Ulid; workstreamId: Ulid }, now: Instant): void {
      const { changes } = insert.run(thread.id, thread.workspaceId, now, thread.workstreamId);
      if (Number(changes) !== 1) throw new RangeError(`no workstream ${thread.workstreamId}`);
    },

    // Marks the thread done, as one over read-only items needs, and records
    // who did: the user unless it says otherwise.
    markDone(id: Ulid, now: Instant, by: Actor = { kind: "user" }): void {
      transaction(db, () => {
        if (Number(mark.run(now, id).changes) !== 1) throw new RangeError(`no thread ${id}`);
        markedBy.run(id, JSON.stringify(by));
      });
    },

    // Takes the thread's done mark off, so it is as it was before: working,
    // unless something else settled it. With `at`, only the mark made then.
    // False if it had none, or another.
    reopen(id: Ulid, at: Instant | null = null): boolean {
      return transaction(db, () => {
        if (Number(unmark.run(id, at).changes) !== 1) return false;
        unmarkedBy.run(id);
        return true;
      });
    },

    // What deleting the thread would lose: what it wrote, which stays in
    // its sources but can no longer be reverted from here.
    wrote(id: Ulid): Wrote {
      mustLoad(id);
      return wrote(id);
    },

    // The user deletes the thread. One that wrote nothing to a source goes
    // with everything in it, and so does its workstream, if that was made for it
    // and is now empty. One that wrote is kept, out of sight, so what it
    // wrote stays on record with its reverse diff, and its review links are
    // revoked. Null, and nothing deleted, while `applying` says one of its
    // change sets is being applied.
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
        for (const statement of purge) statement.run(id);
        const empty = selectEmptyWorkstream.get(thread.workstream_id) !== undefined;
        if (empty) for (const statement of dropEmpty) statement.run(thread.workstream_id);
        return { workstreamId: thread.workstream_id, kept: false, workstreamRemoved: empty };
      });
    },

    get,

    // The title the model wrote for the thread, or null before it did.
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

    // A workspace's threads, newest first, with their latest activity.
    list(workspaceId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByWorkspace.all(workspaceId)).map((id) => summary(id, now));
    },

    // A workstream's threads, newest first.
    ofWorkstream(workstreamId: Ulid, now: Instant): ThreadSummary[] {
      return ids(selectByWorkstream.all(workstreamId)).map((id) => summary(id, now));
    },

    // Adds to the chat; returns the entry's seq.
    append(id: Ulid, message: NewMessage, messageId: Ulid, now: Instant): number {
      return transaction(db, () => append(mustLoad(id), message, messageId, now));
    },

    // The person's message. A thread behind its workstream (one that settled, or
    // was dropped, while the workstream changed) first catches up, with a marker,
    // so the message is about the workstream as it is now (decision 0018).
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

    // The user acted in the thread on its workstream, as by an Undo under
    // the agent's reply: it catches up, with a marker, whatever its state,
    // as their message would make it.
    catchUp(id: Ulid, now: Instant, markerId: Ulid): Move | null {
      return transaction(db, () => move(id, now, markerId));
    },

    // After the workstream changed: each of its working threads moves to the
    // latest version, with a marker. Settled and dropped ones keep theirs
    // until a new message. `newId` names each marker.
    follow(workstreamId: Ulid, now: Instant, newId: () => Ulid): Move[] {
      return transaction(db, () =>
        ids(selectByWorkstream.all(workstreamId)).flatMap((id) => {
          if (get(id, now)?.state !== "working") return [];
          return move(id, now, newId()) ?? [];
        }),
      );
    },

    // The chat after `after`, oldest first.
    messages(id: Ulid, after = 0): Message[] {
      return selectMessages.all(id, after).map(message);
    },

    // The messages held in the thread that wait on the user, oldest first.
    held(id: Ulid): (Held & { seq: number; at: Instant })[] {
      return selectHeld.all(id).flatMap((raw) => {
        const held = message(raw);
        return held.role === "held" ? [held] : [];
      });
    },

    // An event of the agent's at `seq`, as the host now has it: the list
    // under its reply, once the user undid a line of it. False if there's
    // none there.
    rewrite(id: Ulid, seq: number, event: unknown): boolean {
      const json = JSON.stringify(event);
      if (json === undefined) throw new TypeError("a message's content must be JSON");
      return Number(rewriteAgent.run(id, seq, json).changes) === 1;
    },

    // The user sent or discarded the message held at `seq`. False, and
    // nothing changed, if none waits on them there.
    settle(id: Ulid, seq: number, outcome: "sent" | "discarded"): boolean {
      return Number(settleHeld.run(id, seq, outcome).changes) === 1;
    },
  };
}
