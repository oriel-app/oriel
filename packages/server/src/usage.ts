// How much of the person's plan Oriel has used (decision 0046): today's
// turns and tokens on each Claude Code instance, counted from the harness's
// own responses, kept in `usage.json` in the data folder beside
// `settings.json`. Only counts are kept, for today alone: never a message, a
// title or anything a turn said. The plan's own windows are the CLI's answer,
// asked for when Settings shows them, and never kept.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Usage } from "@oriel/agent";
import type { Log } from "@oriel/core";
import type { UsageCountsView } from "@oriel/web/view";

export type UsageCounts = {
  // A response's tokens on an instance, its input counting what it read
  // from the cache too; `turn` when it starts a turn.
  count(instance: string, used: Usage, turn: boolean): void;
  today(instance: string): UsageCountsView;
};

type Kept = { day: string; instances: Record<string, UsageCountsView> };

const none: UsageCountsView = { turns: 0, inputTokens: 0, outputTokens: 0 };

// The local calendar day, as YYYY-MM-DD.
export function localDay(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

const whole = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

// What a file holds, read as counts only; anything else is dropped.
function read(parsed: unknown): Kept {
  const record = typeof parsed === "object" && parsed !== null ? parsed : {};
  const { day, instances } = record as { day?: unknown; instances?: unknown };
  const kept: Kept = { day: typeof day === "string" ? day : "", instances: {} };
  if (typeof instances !== "object" || instances === null) return kept;
  for (const [id, counts] of Object.entries(instances)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || typeof counts !== "object" || counts === null) continue;
    const c = counts as Record<string, unknown>;
    kept.instances[id] = {
      turns: whole(c.turns),
      inputTokens: whole(c.inputTokens),
      outputTokens: whole(c.outputTokens),
    };
  }
  return kept;
}

function counter(initial: Kept, today: () => string, save: (kept: Kept) => void): UsageCounts {
  let kept = initial;
  // Yesterday's counts go when today's first is counted, or asked for.
  const current = () => {
    const day = today();
    if (kept.day !== day) kept = { day, instances: {} };
    return kept;
  };
  return {
    count(instance, used, turn) {
      const at = current();
      const was = at.instances[instance] ?? none;
      at.instances[instance] = {
        turns: was.turns + (turn ? 1 : 0),
        inputTokens: was.inputTokens + used.inputTokens,
        outputTokens: was.outputTokens + used.outputTokens,
      };
      save(at);
    },
    today: (instance) => current().instances[instance] ?? none,
  };
}

// The counts in the file at `path`, read once; each count rewrites it whole
// and renames it into place, readable by its owner only.
export function usageFile(
  path: string,
  log: Log,
  today: () => string = () => localDay(new Date()),
): UsageCounts {
  let initial: Kept = { day: "", instances: {} };
  try {
    initial = read(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log("usage: unreadable, so counting starts again", {});
  }
  return counter(initial, today, (kept) => {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(kept)}\n`, { mode: 0o600 });
      renameSync(temp, path);
    } catch (error) {
      log("usage: couldn't keep the counts", { error: (error as Error).message });
    }
  });
}

export function memoryUsage(today: () => string): UsageCounts {
  return counter({ day: "", instances: {} }, today, () => {});
}
