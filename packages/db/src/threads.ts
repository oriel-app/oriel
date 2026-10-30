// Threads and their states (SPEC §1.3, decision 0018). A thread's state is
// derived from what happened in it, never stored; only the user marking it
// done has no other record, so that time is kept. `now` is passed in.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  nullable,
  number,
  object,
  refine,
  string,
  type Thread,
  type Ulid,
} from "@oriel/core";

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
  // The person's latest message: a new one makes a settled thread working again.
  const lastMessage = db.prepare(
    "select max(at) as at from messages where thread_id = ? and role = 'user'",
  );
  // Anything that happened in the thread, for the idle rule.
  const lastActivity = db.prepare(`
    select max(at) as at from (
      select created_at as at from threads where id = ?1
      union all select at from messages where thread_id = ?1
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

    // The thread as of `now`. Done (a change set applied in full, or the
    // user's mark), handed off (an applied assignee change or attached link)
    // or, failing those, dropped after 7 idle days; anything else is working.
    // A message from the person after it settled makes it working again; of
    // two settlings, the later counts.
    get(id: Ulid, now: Instant): Thread | null {
      const raw = select.get(id);
      if (!raw) return null;
      const parsed = threadRow(raw);
      if (!parsed.ok) throw new Error(`corrupt threads row: ${JSON.stringify(parsed.issues)}`);
      const row = parsed.value;
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
    },
  };
}
