// An eval case is one JSON file, `<id>.json`: its split, its eval kind (SPEC
// §8's numbering), a frozen fixture region, the prompt the user asks there,
// and its expectations, each naming the grader that checks it. A case passes
// when every expectation does.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  array,
  type CapturedMutation,
  type FixtureRegion,
  type Infer,
  type Issue,
  isItemId,
  isNewRef,
  type ItemId,
  type JiraFixture,
  literal,
  type NewRef,
  nullable,
  number,
  object,
  optional,
  refine,
  type Result,
  string,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

// The eval kinds a case can be. Kinds 1 to 6 are deterministic; 7 and 8 are
// graded by an LLM judge. SPEC §8 also has kinds 1, 5 and 6, which no grader
// here can check, so no case may be one: binding correctness (1) and revert
// conflict (5) are unit tests of bindings and change sets, and latency (6)
// needs a timed, streaming test.
export const evalKinds = {
  2: "change-set completeness",
  3: "prompt injection",
  4: "tombstones",
  7: "zoom faithfulness",
  8: "scope discipline",
} as const;
export type EvalKind = keyof typeof evalKinds;

export const isJudged = (kind: number) => kind === 7 || kind === 8;

const text = refine(string, (value) => value.trim() !== "", "expected non-empty text");
const atLeastOne = <T>(item: Validator<T>) =>
  refine(array(item), (items) => items.length > 0, "expected at least one");

export const split = union(literal("train"), literal("test"));
export type Split = Infer<typeof split>;
export const splits: readonly Split[] = ["train", "test"];

const caseId = refine(
  string,
  (id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id),
  "expected a kebab-case ID",
);

const evalKind = refine(
  number,
  (kind): kind is EvalKind => Object.hasOwn(evalKinds, kind),
  "expected an eval kind with a grader: 2, 3, 4, 7 or 8",
);

const goldenPath = refine(
  string,
  (path) => /^tests\/golden\/[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(path),
  "expected tests/golden/<name>.json",
);

// Each grader's expectation. `text` is quoted to the user as `item`'s content,
// and the reply names `item`; `claims` are a rubric for the judge, each one
// checkable on its own.
const expectations = {
  "exact-diff": object({ grader: literal("exact-diff"), golden: goldenPath }),
  "zero-mutations": object({ grader: literal("zero-mutations") }),
  surfaced: object({
    grader: literal("surfaced"),
    item: refine(string, isItemId, "expected an item ID like jira:SYN-12"),
    text: atLeastOne(text),
  }),
  judge: object({ grader: literal("judge"), claims: atLeastOne(text) }),
};
export type GraderName = keyof typeof expectations;
export type Expectation = Infer<(typeof expectations)[GraderName]>;

const isGraderName = (name: unknown): name is GraderName =>
  typeof name === "string" && Object.hasOwn(expectations, name);

export const graderName = refine(string, isGraderName, "expected a grader name");

// Dispatches on `grader`, so a bad expectation reports its own issues rather
// than every alternative's.
const expectation: Validator<Expectation> = (input, path = "$") => {
  const grader =
    typeof input === "object" && input !== null && "grader" in input ? input.grader : null;
  if (!isGraderName(grader)) {
    const names = Object.keys(expectations).join(", ");
    return { ok: false, issues: [{ path: `${path}.grader`, message: `expected one of ${names}` }] };
  }
  return expectations[grader](input, path);
};

const evalCaseShape = object({
  id: caseId,
  split,
  kind: evalKind,
  // A region name from fixtures/jira/regions.json.
  region: text,
  // How many of the fixture's source edits are applied before the case runs.
  // Absent means none.
  edited: optional(refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a whole number")),
  prompt: text,
  expect: atLeastOne(expectation),
});
export type EvalCase = Infer<typeof evalCaseShape>;

// The shape, then the rules a shape can't say.
export function parseEvalCase(input: unknown): Result<EvalCase> {
  const shaped = evalCaseShape(input);
  if (!shaped.ok) return shaped;
  const problems = rules(shaped.value);
  return problems.length ? { ok: false, issues: problems } : shaped;
}

function rules(evalCase: EvalCase): Issue[] {
  const found: Issue[] = [];
  const graders = evalCase.expect.map((e) => e.grader);
  graders.forEach((grader, i) => {
    if (graders.indexOf(grader) !== i)
      found.push({ path: `$.expect[${i}].grader`, message: "one expectation per grader" });
  });
  if (graders.includes("exact-diff") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "a golden diff and zero mutations contradict" });
  const judged = isJudged(evalCase.kind);
  if (judged && !graders.includes("judge"))
    found.push({ path: "$.expect", message: "kinds 7 and 8 are graded by the judge" });
  if (!judged && graders.includes("judge"))
    found.push({ path: "$.expect", message: "kinds 2 to 4 are deterministic: no judge" });
  if (evalCase.kind === 3 && !(graders.includes("zero-mutations") && graders.includes("surfaced")))
    found.push({
      path: "$.expect",
      message: "an injection case expects zero mutations and surfaced text",
    });
  return found;
}

// A golden diff: the mutations a change set should capture, in any order.
const mutationTarget = refine(
  string,
  (value): value is ItemId | NewRef => isItemId(value) || isNewRef(value),
  "expected an item ID or new:N",
);
export const capturedMutation: Validator<CapturedMutation> = object({
  op: text,
  target: nullable(mutationTarget),
  ref: nullable(refine(string, isNewRef, "expected new:N")),
  args: unknown,
});
export const goldenDiff = object({ mutations: array(capturedMutation) });

export type LoadedCase = {
  case: EvalCase;
  region: FixtureRegion;
  // The golden diff's mutations, when an expectation names one.
  golden: CapturedMutation[] | null;
};

// Reads every `*.json` in `dir` as a case, in file-name order, resolving each
// region against the fixture and each golden diff against `root`. A missing
// `dir` holds no cases.
export function loadCases(
  dir: URL,
  fixture: JiraFixture,
  root: URL,
): { cases: LoadedCase[]; problems: string[] } {
  const cases: LoadedCase[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { cases, problems };
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files) {
    const found = loadCase(new URL(name, dir), name, fixture, root);
    if ("problems" in found) problems.push(...found.problems.map((p) => `${name}: ${p}`));
    else cases.push(found);
  }
  return { cases, problems };
}

function loadCase(
  file: URL,
  name: string,
  fixture: JiraFixture,
  root: URL,
): LoadedCase | { problems: string[] } {
  const json = readJson(file);
  if (!json.ok) return { problems: [json.error] };
  const parsed = parseEvalCase(json.value);
  if (!parsed.ok) return { problems: parsed.issues.map(format) };
  const evalCase = parsed.value;
  const problems: string[] = [];
  if (name !== `${evalCase.id}.json`)
    problems.push(`$.id: expected the file to be ${evalCase.id}.json`);
  const region = fixture.regions.find((r) => r.name === evalCase.region);
  if (!region)
    problems.push(`$.region: no fixture region named ${JSON.stringify(evalCase.region)}`);
  if ((evalCase.edited ?? 0) > fixture.edits.length)
    problems.push(`$.edited: the fixture has ${fixture.edits.length} source edits`);
  evalCase.expect.forEach((e, i) => {
    if (e.grader === "surfaced" && region && !region.items.some((id) => id === e.item))
      problems.push(`$.expect[${i}].item: not in region ${region.name}`);
  });
  const golden = loadGolden(evalCase, root);
  if ("problems" in golden) problems.push(...golden.problems);
  if (problems.length || !region || "problems" in golden) return { problems };
  return { case: evalCase, region, golden: golden.mutations };
}

function loadGolden(
  evalCase: EvalCase,
  root: URL,
): { mutations: CapturedMutation[] | null } | { problems: string[] } {
  const named = evalCase.expect.find((e) => e.grader === "exact-diff");
  if (!named) return { mutations: null };
  const json = readJson(new URL(named.golden, root));
  if (!json.ok) return { problems: [`${named.golden}: ${json.error}`] };
  const parsed = parseGoldenDiff(json.value);
  if (!parsed.ok) return { problems: parsed.issues.map((i) => `${named.golden}: ${format(i)}`) };
  return { mutations: parsed.value.mutations };
}

// The shape, then the order a real change set has: a run creates each new
// ref once, before anything names it, so a golden diff must too.
export function parseGoldenDiff(input: unknown): Result<Infer<typeof goldenDiff>> {
  const shaped = goldenDiff(input);
  if (!shaped.ok) return shaped;
  const created = new Set<string>();
  const found: Issue[] = [];
  shaped.value.mutations.forEach((m, i) => {
    const at = `$.mutations[${i}]`;
    for (const { ref, path } of [
      ...namedRefs(m.target, `${at}.target`),
      ...namedRefs(m.args, `${at}.args`),
    ]) {
      if (!created.has(ref))
        found.push({ path, message: `${ref} is used before it is created; create it first` });
    }
    if (!m.ref) return;
    if (created.has(m.ref)) found.push({ path: `${at}.ref`, message: `${m.ref} is created twice` });
    created.add(m.ref);
  });
  return found.length ? { ok: false, issues: found } : shaped;
}

// Every new ref a value names, with its path.
function namedRefs(value: unknown, path: string): { ref: string; path: string }[] {
  if (typeof value === "string") return isNewRef(value) ? [{ ref: value, path }] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => namedRefs(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => namedRefs(v, `${path}.${k}`));
}

function readJson(file: URL): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: false, error: "missing" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const format = (issue: Issue) => `${issue.path}: ${issue.message}`;
