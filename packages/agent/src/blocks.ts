// The blocks a turn shows, for every agent (decision 0030). A run asks for
// one with show(), naming a read this turn ran, its arguments and the
// block's form; Oriel builds the block from what that read answered, so a
// script never hands Oriel a block's numbers. A spec Oriel can't build is
// refused with why, and the run goes on. A run that fails shows nothing, as
// it proposes nothing. The turn shows the blocks it asked for under its
// reply, each once, at most `maxBlocksPerTurn`; the escape hatch's blocks,
// which Oriel shows unasked, don't count. Each block is built from the
// host's own copy of what the read answered, never a value the script
// passes in.
import {
  array,
  isInstant,
  isItemId,
  object,
  refine,
  type SearchHit,
  string,
  type Answered,
  type Bindings,
  type Block,
  blockSpec,
  blockSpecHelp,
  buildBlock,
  maxBlocksPerTurn,
  readKey,
  type RunResult,
  type Ulid,
} from "@oriel/core";
import type { AgentEvent } from "./contract.ts";

// What the host keeps of a read's answer, which a block is built from.
export const answerOf = (
  bindings: Bindings,
  fn: string,
  answer: { value: unknown; outsideRegion: boolean },
): Answered => ({
  value: answer.value,
  outside: answer.outsideRegion,
  fields: bindings.fields?.(fn) ?? null,
});

// What the bindings say a read reached outside the region, checked before it
// reaches the window.
const searchHits = array(
  object({
    id: refine(string, isItemId, "expected an item ID"),
    title: string,
    location: string,
    updatedAt: refine(string, isInstant, "expected an instant"),
  }),
);

export function turnBlocks() {
  // What each read this turn answered, by its name and arguments.
  const answered = new Map<string, Answered>();
  const kept: { runId: Ulid; block: Block }[] = [];
  // Blocks asked for and refused, by the run that asked.
  const refused: Ulid[] = [];

  return {
    // One run's: its show(), its bindings watched so each read they answer
    // is noted, Oriel's line for each block it asked for, and `ran`, which
    // keeps its blocks if it finished.
    run(runId: Ulid, bindingsFor: (show: (input: unknown) => string) => Bindings) {
      const shown: Block[] = [];
      const said: string[] = [];
      const refuse = (why: string) => {
        refused.push(runId);
        return `Oriel refused a block: ${why}`;
      };
      const line = (input: unknown): string => {
        const checked = blockSpec(input);
        if (!checked.ok) return refuse(blockSpecHelp);
        const spec = checked.value;
        const key = readKey(spec.read, spec.args);
        if (!answered.has(key))
          return refuse(
            `no read this turn ran answered ${key}. Run that read first, with those arguments.`,
          );
        const read = answered.get(key);
        const built = read ? buildBlock(spec, read) : null;
        if (!built?.ok) return refuse(`${built?.why ?? "its read is gone"}.`);
        const same = (block: Block) => JSON.stringify(block.spec) === JSON.stringify(spec);
        if (kept.some(({ block }) => same(block)) || shown.some(same))
          return `Oriel already shows that block from ${key}.`;
        // What search() found shows as the escape hatch's block already.
        if (spec.read === "search" && spec.form === "rows")
          return `Oriel already shows what ${key} found, under the run.`;
        if (kept.length + shown.length >= maxBlocksPerTurn)
          return refuse(`a reply shows at most ${maxBlocksPerTurn} blocks you ask for.`);
        shown.push(built.block);
        return `Oriel shows a ${spec.form} block from ${key} under your reply.`;
      };
      const bindings = bindingsFor((input) => {
        const told = line(input);
        said.push(told);
        return told;
      });
      // What the run reached outside the region, which the escape hatch's
      // block shows unasked; the sandbox keeps only each read's hash. A
      // run's reaches share the block, so an item two of them found is in
      // it once, where it was first found.
      const hits = new Map<string, SearchHit>();
      const watched: Bindings = {
        ...bindings,
        read: async (fn, args) => {
          const answer = await bindings.read(fn, args);
          const found = searchHits(answer.found ?? []);
          for (const hit of found.ok ? found.value : [])
            if (!hits.has(hit.id)) hits.set(hit.id, hit);
          if (fn !== "show") answered.set(readKey(fn, args), answerOf(bindings, fn, answer));
          return answer;
        },
      };
      return {
        bindings: watched,
        said,
        // As the run finishes: what it reached outside the region, as the
        // escape hatch, whatever its outcome; and its blocks, if it finished.
        *ran(result: RunResult): Generator<AgentEvent> {
          if (hits.size) yield { kind: "search", runId, hits: [...hits.values()] };
          if (result.outcome === "ok") kept.push(...shown.map((block) => ({ runId, block })));
        },
      };
    },

    // The turn's blocks, as it ends, and each it refused, for telemetry.
    *settle(): Generator<AgentEvent> {
      for (const { runId, block } of kept) yield { kind: "block", runId, block };
      for (const runId of refused) yield { kind: "block.refused", runId };
    },
  };
}
