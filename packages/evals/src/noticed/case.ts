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

const plant = union(
  object({
    op: literal("set"),
    item: itemName,
    state: optional(state),
    assignee: optional(text),
    estimate: optional(number),
    epic: optional(itemName),
    daysAgo: optional(whole),
  }),
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
  object({ op: literal("estimate"), item: itemName, from: number, to: number, daysAgo: whole }),
  object({ op: literal("done"), item: itemName, daysAgo: whole }),
  object({ op: literal("join"), items: array(itemName), epic: itemName, daysAgo: whole }),
  object({
    op: literal("message"),
    author: text,
    text,
    names: array(itemName),
    daysAgo: whole,
  }),
  object({
    op: literal("quiet"),
    region: optional(text),
    epic: optional(itemName),
    items: optional(array(itemName)),
    daysAgo: whole,
  }),
  object({ op: literal("text"), item: itemName, append: text }),
);
export type Plant = Infer<typeof plant>;

const noticedCaseShape = object({
  id: refine(string, (id) => /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(id), "expected a kebab-case ID"),
  split: union(literal("train"), literal("test")),
  group: text,
  base: union(literal("as-is"), literal("fresh"), literal("big")),
  at: refine(string, isInstant, "expected an instant"),
  workstreams: array(
    object({
      name: text,
      region: optional(text),
      epic: optional(itemName),
      items: optional(array(itemName)),
    }),
  ),
  plants: array(plant),
  expect: object({ find: array(text), avoid: array(text) }),
  about: text,
});
export type NoticedCase = Infer<typeof noticedCaseShape>;

export const noticedCasesDir = new URL("../../noticed/cases/", import.meta.url);

export function parseNoticedCase(input: unknown): Result<NoticedCase> {
  return noticedCaseShape(input);
}

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
