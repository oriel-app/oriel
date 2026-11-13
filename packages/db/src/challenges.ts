import type { DatabaseSync } from "node:sqlite";
import {
  array,
  type Basis,
  type CapturedMutation,
  type Challenge,
  type Coverage,
  type Finding,
  type Instant,
  isInstant,
  isItemId,
  isNewRef,
  isUlid,
  type ItemId,
  type NewRef,
  literal,
  nullable,
  number,
  object,
  optional,
  refine,
  storedFinding,
  string,
  type Ulid,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

const ulidText = refine(string, isUlid, "expected a ULID");
const instantText = refine(string, isInstant, "expected an instant");
const itemText = refine(string, isItemId, "expected an item ID");
const row = object({
  id: ulidText,
  workspace_id: ulidText,
  change_set_id: ulidText,
  thread_id: ulidText,
  hash: string,
  state: union(literal("running"), literal("ready"), literal("failed")),
  findings: string,
  companions: string,
  added: string,
  coverage: nullable(string),
  basis: string,
  error: nullable(string),
  model: nullable(string),
  input_tokens: number,
  output_tokens: number,
  started_at: instantText,
  finished_at: nullable(instantText),
  dismissed_at: nullable(instantText),
});
const companion: Validator<CapturedMutation> = object({
  op: string,
  target: nullable(
    refine(
      string,
      (value): value is ItemId | NewRef => isItemId(value) || isNewRef(value),
      "expected an item ID or a new:N ref",
    ),
  ),
  ref: nullable(refine(string, isNewRef, "expected a new:N ref")),
  args: unknown,
  into: optional(string),
});
const coverage: Validator<Coverage> = object({
  read: array(itemText),
  of: number,
  searches: number,
});
const basis: Validator<Basis[]> = array(object({ id: itemText, updatedAt: nullable(instantText) }));

const parsed = <T>(validator: Validator<T>, text: string, what: string): T => {
  const result = validator(JSON.parse(text) as unknown);
  if (!result.ok) throw new Error(`unreadable challenge ${what}: ${result.issues[0]?.message}`);
  return result.value;
};

export type ChallengeStore = ReturnType<typeof challengeStore>;

export function challengeStore(db: DatabaseSync) {
  const insert = db.prepare(`
    insert into challenges (id, workspace_id, change_set_id, thread_id, hash, state, started_at)
    values (?, ?, ?, ?, ?, 'running', ?)`);
  const ready = db.prepare(`
    update challenges set state = 'ready', findings = ?2, companions = ?3, coverage = ?4,
      basis = ?5, model = ?6, input_tokens = ?7, output_tokens = ?8, finished_at = ?9
    where id = ?1 and state = 'running'`);
  const failed = db.prepare(`
    update challenges set state = 'failed', error = ?2, model = ?3, input_tokens = ?4,
      output_tokens = ?5, finished_at = ?6
    where id = ?1 and state = 'running'`);
  const setAdded = db.prepare("update challenges set added = ? where id = ?");
  const setDismissed = db.prepare("update challenges set dismissed_at = ? where id = ?");
  const selectLatest = db.prepare(
    "select * from challenges where change_set_id = ? order by rowid desc limit 1",
  );
  const selectOne = db.prepare("select * from challenges where id = ?");
  const selectUsage = db.prepare(`
    select coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output
    from challenges where thread_id = ?`);
  const abandon = db.prepare(`
    update challenges set state = 'failed', error = ?, finished_at = ?
    where state = 'running'`);

  const load = (raw: unknown): Challenge | null => {
    if (raw === undefined) return null;
    const checked = row(raw);
    if (!checked.ok) throw new Error(`unreadable challenge row: ${checked.issues[0]?.message}`);
    const r = checked.value;
    return {
      id: r.id as Ulid,
      workspaceId: r.workspace_id as Ulid,
      changeSetId: r.change_set_id as Ulid,
      threadId: r.thread_id as Ulid,
      hash: r.hash,
      state: r.state,
      findings: parsed(array(storedFinding), r.findings, "findings"),
      companions: parsed(array(companion), r.companions, "companions"),
      added: parsed(array(number), r.added, "added"),
      coverage: r.coverage === null ? null : parsed(coverage, r.coverage, "coverage"),
      basis: parsed(basis, r.basis, "basis"),
      error: r.error,
      model: r.model,
      usage: { inputTokens: r.input_tokens, outputTokens: r.output_tokens },
      startedAt: r.started_at as Instant,
      finishedAt: r.finished_at as Instant | null,
      dismissedAt: r.dismissed_at as Instant | null,
    };
  };

  return {
    start(look: {
      id: Ulid;
      workspaceId: Ulid;
      changeSetId: Ulid;
      threadId: Ulid;
      hash: string;
      at: Instant;
    }): void {
      insert.run(look.id, look.workspaceId, look.changeSetId, look.threadId, look.hash, look.at);
    },

    ready(
      id: Ulid,
      done: {
        findings: readonly Finding[];
        companions: readonly CapturedMutation[];
        coverage: Coverage;
        basis: readonly Basis[];
        model: string | null;
        usage: { inputTokens: number; outputTokens: number };
        at: Instant;
      },
    ): void {
      ready.run(
        id,
        JSON.stringify(done.findings),
        JSON.stringify(done.companions),
        JSON.stringify(done.coverage),
        JSON.stringify(done.basis),
        done.model,
        done.usage.inputTokens,
        done.usage.outputTokens,
        done.at,
      );
    },

    failed(
      id: Ulid,
      why: string,
      model: string | null,
      usage: { inputTokens: number; outputTokens: number },
      at: Instant,
    ): void {
      failed.run(id, why, model, usage.inputTokens, usage.outputTokens, at);
    },

    added(id: Ulid, place: number): void {
      const look = load(selectOne.get(id));
      if (!look || look.added.includes(place)) return;
      setAdded.run(JSON.stringify([...look.added, place].sort((a, b) => a - b)), id);
    },

    dismissed(id: Ulid, at: Instant | null): void {
      setDismissed.run(at, id);
    },

    get: (id: Ulid): Challenge | null => load(selectOne.get(id)),

    usage(threadId: Ulid): { inputTokens: number; outputTokens: number } {
      const row = selectUsage.get(threadId) as { input: number; output: number } | undefined;
      return { inputTokens: row?.input ?? 0, outputTokens: row?.output ?? 0 };
    },

    latest: (changeSetId: Ulid): Challenge | null => load(selectLatest.get(changeSetId)),

    abandonRunning(at: Instant): void {
      abandon.run("Oriel stopped before the second look finished.", at);
    },
  };
}
