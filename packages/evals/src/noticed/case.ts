// A Noticed case (decision 0052): a window built from the
// fixtures, with insights planted in it, and what a good pass shows of it.
// One JSON file a case, `noticed/cases/<id>.json`. Planting changes the
// world in memory, as `scripts/big-world.ts` grows SYN: no fixture file
// changes.
//
// Expectations name signals as Oriel's IDs do, `<kind>:<subject>`, where a
// workstream is `@<its name>`, a person their fixture ID, and an item its
// fixture name: `stalled:@Checkout`, `overloaded:farid`, `scope:jira:SYN-3`.
// `find` must show; `avoid` must not. Any other signal may show or not.
import { readdirSync, readFileSync } from "node:fs";
import {
  array,
  type Infer,
  isInstant,
  literal,
  number,
  object,
  optional,
  refine,
  type Result,
  string,
  union,
} from "@oriel/core";

const text = refine(string, (value) => value.trim() !== "", "expected text");
const whole = refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a whole number");
const itemName = refine(string, (name) => /^[a-z]{2,16}:./su.test(name), "expected kind:name");
const state = union(literal("todo"), literal("in-progress"), literal("done"));

// Each way a case changes its world, `daysAgo` before the case's clock.
const plant = union(
  // An item's facets now, and when it last changed.
  object({
    op: literal("set"),
    item: itemName,
    state: optional(state),
    assignee: optional(text),
    estimate: optional(number),
    epic: optional(itemName),
    daysAgo: optional(whole),
  }),
  // A new Jira item, with its text.
  object({
    op: literal("new"),
    key: refine(string, (key) => /^SYN-\d+$/u.test(key), "expected SYN-<n>"),
    title: text,
    kind: text,
    state,
    assignee: optional(text),
    estimate: optional(number),
    epic: optional(itemName),
    text: optional(text),
    daysAgo: whole,
  }),
  // A sync logged an estimate change.
  object({ op: literal("estimate"), item: itemName, from: number, to: number, daysAgo: whole }),
  // A sync logged an item moving to done.
  object({ op: literal("done"), item: itemName, daysAgo: whole }),
  // A sync logged items moving into an epic.
  object({ op: literal("join"), items: array(itemName), epic: itemName, daysAgo: whole }),
  // A chat message in the fixture's Slack channel, naming items.
  object({
    op: literal("message"),
    author: text,
    text,
    names: array(itemName),
    daysAgo: whole,
  }),
  // Nothing changed in these items for `daysAgo` days, give or take two: a
  // fixture region's, an epic's and its children, or a list.
  object({
    op: literal("quiet"),
    region: optional(text),
    epic: optional(itemName),
    items: optional(array(itemName)),
    daysAgo: whole,
  }),
  // Words added to an item's text, such as a comment.
  object({ op: literal("text"), item: itemName, append: text }),
);
export type Plant = Infer<typeof plant>;

const noticedCaseShape = object({
  id: refine(string, (id) => /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(id), "expected a kebab-case ID"),
  split: union(literal("train"), literal("test")),
  // What the case is about, for the climb's guard: a signal kind, or
  // "decoys" for a window where nothing should show.
  group: text,
  // The world: SYN as its fixtures have it, or "fresh", where every fixture
  // item changed in the last week, so only what is planted stands out; and
  // "big", SYN grown to 4,000 items as `pnpm perf` grows it.
  base: union(literal("as-is"), literal("fresh"), literal("big")),
  at: refine(string, isInstant, "expected an instant"),
  workstreams: array(
    object({
      name: text,
      region: optional(text),
      // An epic and its children, as they are once planted.
      epic: optional(itemName),
      items: optional(array(itemName)),
    }),
  ),
  plants: array(plant),
  expect: object({ find: array(text), avoid: array(text) }),
  // What the case is for, in a sentence.
  about: text,
});
export type NoticedCase = Infer<typeof noticedCaseShape>;

export const noticedCasesDir = new URL("../../noticed/cases/", import.meta.url);

export function parseNoticedCase(input: unknown): Result<NoticedCase> {
  return noticedCaseShape(input);
}

// Every case, by its ID; a malformed one throws, naming the file.
export function loadNoticedCases(dir: URL = noticedCasesDir): NoticedCase[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => {
      const parsed = parseNoticedCase(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
      if (!parsed.ok)
        throw new Error(
          `${name}: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
        );
      if (`${parsed.value.id}.json` !== name) throw new Error(`${name}: its id must match`);
      return parsed.value;
    });
}
