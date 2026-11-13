// A block is built from the host's own copy of what a read answered, never a value the script
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
  ignoredKeys,
  isChart,
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
  specProblems,
  type Ulid,
} from "@oriel/core";
import type { AgentEvent } from "./contract.ts";

export const answerOf = (
  bindings: Bindings,
  fn: string,
  answer: { value: unknown; outsideRegion: boolean },
): Answered => ({
  value: answer.value,
  outside: answer.outsideRegion,
  fields: bindings.fields?.(fn) ?? null,
});

const searchHits = array(
  object({
    id: refine(string, isItemId, "expected an item ID"),
    title: string,
    location: string,
    updatedAt: refine(string, isInstant, "expected an instant"),
  }),
);

const ignored = (input: unknown): string => {
  const keys = ignoredKeys(input);
  if (!keys.length) return "";
  const named = keys.slice(0, 5).map((key) => `\`${key.slice(0, 40)}\``);
  return ` show() ignored ${named.join(", ")}${keys.length > 5 ? " and more" : ""}: Oriel writes each block's caption and order, and only \`where\` keeps some rows.`;
};

type Kept = { kind: "block"; block: Block } | { kind: "sketch"; sketch: Sketch };

const sketchShown = (height: number) =>
  `Oriel shows your sketch under your reply, ${height} px high, captioned as yours. Its sheet sets ${sketchTokens.join(", ")}.`;

export function turnShown(newId: () => Ulid) {
  const answered = new Map<string, Answered>();
  const kept: { runId: Ulid; shown: Kept }[] = [];
  const refused: AgentEvent[] = [];

  return {
    run(runId: Ulid, bindingsFor: (shown: Shown) => Bindings) {
      const shown: Kept[] = [];
      const said: string[] = [];
      const all = (kind: Kept["kind"]) =>
        [...kept.map((k) => k.shown), ...shown].filter((k) => k.kind === kind);
      const ran = () => {
        const keys = [...answered.keys()].map((key) => key.slice(0, 80));
        if (!keys.length) return "This turn ran no read.";
        const more = keys.length > 8 ? ` and ${keys.length - 8} more` : "";
        return `This turn ran ${keys.slice(0, 8).join(", ")}${more}.`;
      };
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
          return `Oriel refused a block: ${why}${ignored(input)}`;
        };
        const checked = blockSpec(input);
        if (!checked.ok)
          return refuse(`${specProblems(input)}. In full: ${blockSpecHelp}${declared(input)}`);
        const spec = checked.value;
        const key = readKey(spec.read, spec.args);
        if (!answered.has(key))
          return refuse(
            `no read this turn ran answered ${key}. ${ran()} Run that read first, with those arguments.`,
          );
        const read = answered.get(key);
        const built = read ? buildBlock(spec, read) : null;
        if (!built?.ok) return refuse(`${built?.why ?? "its read is gone"}.`);
        const blocks = all("block");
        const extra = ignored(input);
        const every = extra && !spec.where ? " This one keeps every row." : "";
        if (
          blocks.some(
            (k) => k.kind === "block" && JSON.stringify(k.block.spec) === JSON.stringify(spec),
          )
        )
          return `Oriel already shows that block from ${key}.${extra}${every}`;
        if (spec.read === "search" && spec.form === "rows")
          return `Oriel already shows what ${key} found, under the run.${extra}${every}`;
        if (blocks.length >= maxBlocksPerTurn)
          return refuse(`a reply shows at most ${maxBlocksPerTurn} blocks you ask for.`);
        shown.push({ kind: "block", block: built.block });
        const said = `Oriel shows a ${spec.form} block from ${key} under your reply.${extra}${every}`;
        return isChart(spec) ? `${said} Its caption: ${built.block.caption}.` : said;
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
      const hits = new Map<string, SearchHit>();
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
        *ran(result: RunResult): Generator<AgentEvent> {
          if (hits.size) yield { kind: "search", runId, hits: [...hits.values()] };
          for (const block of previews) yield { kind: "block", runId, block };
          if (result.outcome === "ok") kept.push(...shown.map((each) => ({ runId, shown: each })));
        },
      };
    },

    *settle(): Generator<AgentEvent> {
      for (const { runId, shown } of kept)
        yield shown.kind === "block"
          ? { kind: "block", runId, block: shown.block }
          : { kind: "sketch", runId, sketch: shown.sketch };
      yield* refused;
    },
  };
}
