// Runs, as SPEC §7 records them: what each one read and used, so production
// runs are attributable. Each proxied read keeps its arguments and a hash of
// its payload, never the payload.
import type { DatabaseSync } from "node:sqlite";
import type { ProxiedRead, Run } from "@oriel/core";
import { transaction } from "./open.ts";

export type RunStore = ReturnType<typeof runStore>;

export function runStore(db: DatabaseSync) {
  const insertRun = db.prepare(`
    insert into runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
      dts_hash, model, input_tokens, output_tokens, wall_ms, cold_start_ms, outcome, started_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRead = db.prepare(`
    insert into run_reads (workspace_id, run_id, seq, fn, args, ms, outside_region, status,
      payload_hash)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  return {
    // The run and its reads, together or not at all.
    record(run: Run, reads: readonly ProxiedRead[]): void {
      transaction(db, () => {
        insertRun.run(
          run.id,
          run.workspaceId,
          run.threadId,
          run.snapshot,
          run.regionVersion,
          run.systemPromptHash,
          run.dtsHash,
          run.model,
          run.inputTokens,
          run.outputTokens,
          Math.round(run.wallMs),
          run.coldStartMs === null ? null : Math.round(run.coldStartMs),
          run.outcome,
          run.startedAt,
        );
        reads.forEach((read, i) => {
          const answered = read.status === "answered";
          insertRead.run(
            run.workspaceId,
            run.id,
            i + 1,
            read.fn,
            JSON.stringify(read.args) ?? "null",
            Math.round(read.ms),
            answered ? Number(read.outsideRegion ?? false) : null,
            read.status,
            answered ? (read.payloadHash ?? "") : null,
          );
        });
      });
    },
  };
}
