// What a turn shows under its reply, for every agent: blocks (decision 0030)
// and sketches (decision 0033). A run asks for a block with show(), naming a
// read this turn ran, its arguments and the block's form; Oriel builds the
// block from what that read answered, so a script never hands Oriel a
// block's numbers. A run hands sketch() its HTML and a height; Oriel checks
// the text and shows it in a sandboxed frame. What Oriel can't build or
// show is refused with why, and the run goes on. A run that fails shows
// nothing, as it proposes nothing. The turn shows what it asked for under
// its reply, in the order asked, each once: at most `maxBlocksPerTurn`
// blocks and `maxSketchesPerTurn` sketches. The escape hatch's blocks,
// which Oriel shows unasked, don't count, nor does a waiting connection's
// preview, which it shows unasked too (decision 0051). Each block is built from the
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
  checkSketch,
  declaredFields,
  isSketchHeight,
  maxBlocksPerTurn,
  maxSketchesPerTurn,
  previewBlock,
  previewTable,
  readKey,
  type RunResult,
  type Shown,
  type Sketch,
  type SketchRefusal,
  sketchTokens,
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

// What a turn shows under its reply, in the order its runs asked for it.
type Kept = { kind: "block"; block: Block } | { kind: "sketch"; sketch: Sketch };

// What the agent reads after a sketch Oriel shows: the theme variables its
// sheet sets, so the next sketch can use them.
const sketchShown = (height: number) =>
  `Oriel shows your sketch under your reply, ${height} px high, captioned as yours. Its sheet sets ${sketchTokens.join(", ")}.`;

export function turnShown(newId: () => Ulid) {
  // What each read this turn answered, by its name and arguments.
  const answered = new Map<string, Answered>();
  const kept: { runId: Ulid; shown: Kept }[] = [];
  // What runs asked for and Oriel refused, by the run that asked.
  const refused: AgentEvent[] = [];

  return {
    // One run's: its show() and sketch(), its bindings watched so each read
    // they answer is noted, Oriel's line for each thing it asked for, and
    // `ran`, which keeps what it asked for if it finished.
    run(runId: Ulid, bindingsFor: (shown: Shown) => Bindings) {
      const shown: Kept[] = [];
      const said: string[] = [];
      const all = (kind: Kept["kind"]) =>
        [...kept.map((k) => k.shown), ...shown].filter((k) => k.kind === kind);
      // What the read a refused spec names declares, if this turn ran it.
      const declared = (input: unknown): string => {
        const read =
          typeof input === "object" && input !== null && "read" in input ? input.read : null;
        const fields = [...answered]
          .filter(([key]) => typeof read === "string" && key.startsWith(`${read}(`))
          .map(([, answer]) => answer.fields)
          .find((found) => found !== null);
        return typeof read === "string" && fields ? ` ${declaredFields(read, fields)}.` : "";
      };
      const block = (input: unknown): string => {
        const refuse = (why: string) => {
          refused.push({ kind: "block.refused", runId });
          return `Oriel refused a block: ${why}`;
        };
        const checked = blockSpec(input);
        if (!checked.ok) return refuse(`${blockSpecHelp}${declared(input)}`);
        const spec = checked.value;
        const key = readKey(spec.read, spec.args);
        if (!answered.has(key))
          return refuse(
            `no read this turn ran answered ${key}. Run that read first, with those arguments.`,
          );
        const read = answered.get(key);
        const built = read ? buildBlock(spec, read) : null;
        if (!built?.ok) return refuse(`${built?.why ?? "its read is gone"}.`);
        const blocks = all("block");
        if (
          blocks.some(
            (k) => k.kind === "block" && JSON.stringify(k.block.spec) === JSON.stringify(spec),
          )
        )
          return `Oriel already shows that block from ${key}.`;
        // What search() found shows as the escape hatch's block already.
        if (spec.read === "search" && spec.form === "rows")
          return `Oriel already shows what ${key} found, under the run.`;
        if (blocks.length >= maxBlocksPerTurn)
          return refuse(`a reply shows at most ${maxBlocksPerTurn} blocks you ask for.`);
        shown.push({ kind: "block", block: built.block });
        return `Oriel shows a ${spec.form} block from ${key} under your reply.`;
      };
      const sketch = (html: unknown, height: unknown): string => {
        const refuse = (reason: SketchRefusal, why: string) => {
          refused.push({ kind: "sketch.refused", runId, reason });
          return `Oriel refused the sketch, and shows nothing: ${why}.`;
        };
        if (typeof html !== "string" || !isSketchHeight(height))
          return refuse(
            "malformed",
            "sketch(html, h) takes HTML as a string and h as 240, 400 or 640",
          );
        const checked = checkSketch(html);
        if (!checked.ok) return refuse(checked.reason, checked.why);
        const sketches = all("sketch");
        const same = (k: Kept) =>
          k.kind === "sketch" && k.sketch.html === html && k.sketch.height === height;
        if (sketches.some(same)) return "Oriel already shows that sketch under your reply.";
        if (sketches.length >= maxSketchesPerTurn)
          return refuse("too-many", `a reply shows at most ${maxSketchesPerTurn} sketches`);
        shown.push({ kind: "sketch", sketch: { id: newId(), html, height } });
        return sketchShown(height);
      };
      const say = (told: string) => {
        said.push(told);
        return told;
      };
      const bindings = bindingsFor({
        show: (input) => say(block(input)),
        sketch: (html, height) => say(sketch(html, height)),
      });
      // What the run reached outside the region, which the escape hatch's
      // block shows unasked; the sandbox keeps only each read's hash. A
      // run's reaches share the block, so an item two of them found is in
      // it once, where it was first found.
      const hits = new Map<string, SearchHit>();
      // What a waiting connection's preview read showed, as its block.
      const previews: Block[] = [];
      const watched: Bindings = {
        ...bindings,
        read: async (fn, args) => {
          const answer = await bindings.read(fn, args);
          const tables = array(previewTable)(answer.preview ?? []);
          if (tables.ok && tables.value.length) previews.push(previewBlock(fn, args, tables.value));
          const found = searchHits(answer.found ?? []);
          for (const hit of found.ok ? found.value : [])
            if (!hits.has(hit.id)) hits.set(hit.id, hit);
          if (fn !== "show" && fn !== "sketch")
            answered.set(readKey(fn, args), answerOf(bindings, fn, answer));
          return answer;
        },
      };
      return {
        bindings: watched,
        said,
        // As the run finishes: what it reached outside the region, as the
        // escape hatch, and the previews it read, whatever its outcome; and what it asked to show, if
        // it finished.
        *ran(result: RunResult): Generator<AgentEvent> {
          if (hits.size) yield { kind: "search", runId, hits: [...hits.values()] };
          for (const block of previews) yield { kind: "block", runId, block };
          if (result.outcome === "ok") kept.push(...shown.map((each) => ({ runId, shown: each })));
        },
      };
    },

    // What the turn shows, as it ends, and each thing it refused, for
    // telemetry.
    *settle(): Generator<AgentEvent> {
      for (const { runId, shown } of kept)
        yield shown.kind === "block"
          ? { kind: "block", runId, block: shown.block }
          : { kind: "sketch", runId, sketch: shown.sketch };
      yield* refused;
    },
  };
}
