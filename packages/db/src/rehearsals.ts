// Release rehearsals (the release-rehearsal spike): which threads rehearse
// a workstream's release, and the rehearsals their turns recorded, as Oriel
// checked them. The newest record is the one a workstream shows.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  number,
  object,
  refine,
  type Rehearsal,
  rehearsalBody,
  type Seen,
  storedSeen,
  string,
  type Ulid,
} from "@oriel/core";

const ulidText = refine(string, isUlid, "expected a ULID");
const instantText = refine(string, isInstant, "expected an instant");
const startedRow = object({ thread_id: ulidText, started_at: instantText });
const recordRow = object({
  id: ulidText,
  thread_id: ulidText,
  region_version: refine(number, Number.isSafeInteger, "expected a whole number"),
  situations: string,
  seen: string,
  at: instantText,
});

export type RehearsalStore = ReturnType<typeof rehearsalStore>;

export function rehearsalStore(db: DatabaseSync) {
  const insertThread = db.prepare(`
    insert into rehearsal_threads (thread_id, workspace_id, workstream_id, started_at)
    select id, workspace_id, workstream_id, ?2 from threads where id = ?1`);
  const selectIs = db.prepare("select 1 from rehearsal_threads where thread_id = ?");
  const selectNewest = db.prepare(`
    select r.thread_id, r.started_at from rehearsal_threads r join threads t on t.id = r.thread_id
    where r.workstream_id = ? and t.id not in (select thread_id from deleted_threads)
    order by r.started_at desc, r.thread_id desc limit 1`);
  const insertRecord = db.prepare(`
    insert into rehearsals (id, workspace_id, thread_id, region_version, situations, seen, at)
    select ?1, workspace_id, thread_id, ?3, ?4, ?5, ?6 from rehearsal_threads where thread_id = ?2`);
  const selectRecord = db.prepare(`
    select id, thread_id, region_version, situations, seen, at from rehearsals
    where thread_id = ? order by at desc, id desc limit 1`);

  const parsed = (raw: unknown): Rehearsal => {
    const row = recordRow(raw);
    if (!row.ok) throw new Error(`corrupt rehearsals row: ${JSON.stringify(row.issues)}`);
    const situations = rehearsalBody(JSON.parse(row.value.situations));
    const seen = storedSeen(JSON.parse(row.value.seen));
    if (!situations.ok || !seen.ok) throw new Error(`corrupt rehearsal ${row.value.id}`);
    return {
      id: row.value.id,
      threadId: row.value.thread_id,
      regionVersion: row.value.region_version,
      situations: situations.value,
      seen: seen.value,
      at: row.value.at,
    };
  };

  return {
    // The thread rehearses its workstream's release.
    start(thread: Ulid, now: Instant): void {
      if (Number(insertThread.run(thread, now).changes) !== 1)
        throw new RangeError(`no thread ${thread}`);
    },

    is(thread: Ulid): boolean {
      return selectIs.get(thread) !== undefined;
    },

    record(
      thread: Ulid,
      kept: { id: Ulid; regionVersion: number; situations: Rehearsal["situations"]; seen: Seen[] },
      now: Instant,
    ): void {
      const inserted = insertRecord.run(
        kept.id,
        thread,
        kept.regionVersion,
        JSON.stringify(kept.situations),
        JSON.stringify(kept.seen),
        now,
      );
      if (Number(inserted.changes) !== 1)
        throw new RangeError(`${thread} isn't a rehearsal thread`);
    },

    // The thread's newest rehearsal, or null before its turn recorded one.
    of(thread: Ulid): Rehearsal | null {
      const raw = selectRecord.get(thread);
      return raw === undefined ? null : parsed(raw);
    },

    // The workstream's newest rehearsal thread, with its newest rehearsal.
    newest(
      workstream: Ulid,
    ): { thread: Ulid; startedAt: Instant; rehearsal: Rehearsal | null } | null {
      const raw = selectNewest.get(workstream);
      if (raw === undefined) return null;
      const row = startedRow(raw);
      if (!row.ok) throw new Error(`corrupt rehearsal_threads row: ${JSON.stringify(row.issues)}`);
      return {
        thread: row.value.thread_id as Ulid,
        startedAt: row.value.started_at,
        rehearsal: this.of(row.value.thread_id as Ulid),
      };
    },
  };
}
