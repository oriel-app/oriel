// An eval case is one JSON file, `<id>.json`: its split, its eval kind (SPEC
// §8's numbering), a frozen region from the fixtures, the prompt the user
// asks there, and its expectations, each naming the grader that checks it. A
// case passes when every expectation does.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  array,
  type CapturedMutation,
  type Infer,
  type Issue,
  isItemId,
  isNewRef,
  type ItemId,
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
import type { FixtureRegion, JiraFixture } from "@oriel/jira";
import { diskDependent, type FolderFixture } from "../../../scripts/fixtures/folder.ts";

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
const whole = refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a whole number");
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

// Each grader's expectation. `text` is quoted to the user as the content of
// `item`, an item ID, or of `file`, a file from the folder fixture by its
// path, and the reply names it: an item by its key, a file by its title.
// `claims` are a rubric for the judge, each one checkable on its own.
const surfacedItem = object({
  grader: literal("surfaced"),
  item: refine(string, isItemId, "expected an item ID like jira:SYN-12"),
  text: atLeastOne(text),
});
const surfacedFile = object({ grader: literal("surfaced"), file: text, text: atLeastOne(text) });
const has = (input: unknown, key: string) =>
  typeof input === "object" && input !== null && key in input;

const expectations = {
  "exact-diff": object({ grader: literal("exact-diff"), golden: goldenPath }),
  "zero-mutations": object({ grader: literal("zero-mutations") }),
  // An item, unless it names only a file.
  surfaced: ((input, path = "$") => {
    if (has(input, "item") && has(input, "file"))
      return { ok: false, issues: [{ path, message: "expected an item or a file, not both" }] };
    return has(input, "file") ? surfacedFile(input, path) : surfacedItem(input, path);
  }) satisfies Validator<Infer<typeof surfacedItem> | Infer<typeof surfacedFile>>,
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

// The region holds a Jira fixture region's items, files from the folder
// fixture, or both.
const evalCaseShape = object({
  id: caseId,
  split,
  kind: evalKind,
  // A region name from fixtures/jira/regions.json.
  region: optional(text),
  // Paths from fixtures/folder/tree.json: a file before any edit, or the
  // name an edit renames one to.
  files: optional(atLeastOne(text)),
  // How many of the Jira fixture's source edits are applied before the case
  // runs. Absent means none.
  edited: optional(whole),
  // How many of the folder fixture's edits are applied. Absent means none.
  folderEdited: optional(whole),
  // Why the case can't run yet, such as a golden diff the maintainer hasn't
  // approved. It is checked and listed, never run.
  waiting: optional(text),
  // What the agent gets wrong here, as a live round found it: a known
  // failure, which doesn't fail CI's replay until the case passes.
  failing: optional(text),
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
  if (evalCase.region === undefined && evalCase.files === undefined)
    found.push({ path: "$", message: "a case's region needs a fixture region, files, or both" });
  const files = evalCase.files ?? [];
  files.forEach((file, i) => {
    if (files.indexOf(file) !== i) found.push({ path: `$.files[${i}]`, message: "listed twice" });
  });
  if (evalCase.waiting !== undefined && evalCase.failing !== undefined)
    found.push({ path: "$.failing", message: "a waiting case never runs, so it can't be failing" });
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
  // The Jira fixture region the case names, if any.
  region: FixtureRegion | null;
  // The golden diff's mutations, when an expectation names one and the case
  // isn't waiting for it.
  golden: CapturedMutation[] | null;
};

// Reads every `*.json` in `dir` as a case, in file-name order, resolving each
// region against the fixtures and each golden diff against `root`. A missing
// `dir` holds no cases. Without `folder`, a case that uses it is refused.
export function loadCases(
  dir: URL,
  fixture: JiraFixture,
  root: URL,
  folder: FolderFixture | null = null,
): { cases: LoadedCase[]; problems: string[] } {
  const cases: LoadedCase[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { cases, problems };
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files) {
    const found = loadCase(new URL(name, dir), name, fixture, root, folder);
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
  folder: FolderFixture | null,
): LoadedCase | { problems: string[] } {
  const json = readJson(file);
  if (!json.ok) return { problems: [json.error] };
  const parsed = parseEvalCase(json.value);
  if (!parsed.ok) return { problems: parsed.issues.map(format) };
  const evalCase = parsed.value;
  const problems: string[] = [];
  if (name !== `${evalCase.id}.json`)
    problems.push(`$.id: expected the file to be ${evalCase.id}.json`);
  const named = evalCase.region;
  const region = named === undefined ? null : fixture.regions.find((r) => r.name === named);
  if (region === undefined)
    problems.push(`$.region: no fixture region named ${JSON.stringify(named)}`);
  if ((evalCase.edited ?? 0) > fixture.edits.length)
    problems.push(`$.edited: the fixture has ${fixture.edits.length} source edits`);
  problems.push(...fileProblems(evalCase, folder));
  evalCase.expect.forEach((e, i) => {
    if (e.grader !== "surfaced") return;
    if ("item" in e && region !== undefined && !region?.items.some((id) => id === e.item))
      problems.push(`$.expect[${i}].item: not in region ${region?.name ?? "(none)"}`);
    if ("file" in e && !evalCase.files?.includes(e.file))
      problems.push(`$.expect[${i}].file: not one of the case's files`);
  });
  const golden = loadGolden(evalCase, root);
  if ("problems" in golden) problems.push(...golden.problems);
  if (problems.length || region === undefined || "problems" in golden) return { problems };
  return { case: evalCase, region, golden: golden.mutations };
}

// A case's files are in the folder fixture, before its edits or under a name
// an edit gives one, and are the same on every disk.
function fileProblems(evalCase: EvalCase, folder: FolderFixture | null): string[] {
  const files = evalCase.files ?? [];
  const edited = evalCase.folderEdited ?? 0;
  if (!folder) return files.length || edited ? ["$.files: no folder fixture was loaded"] : [];
  const problems: string[] = [];
  if (edited > folder.edits.length)
    problems.push(`$.folderEdited: the folder fixture has ${folder.edits.length} edits`);
  const known = new Set([
    ...folder.files.map((f) => f.path),
    ...folder.edits.flatMap((e) => (e.kind === "rename" ? [e.to] : [])),
  ]);
  const dependent = diskDependent(folder);
  files.forEach((path, i) => {
    if (!known.has(path))
      problems.push(`$.files[${i}]: ${JSON.stringify(path)} isn't in the folder fixture`);
    if (dependent.has(path))
      problems.push(
        `$.files[${i}]: ${JSON.stringify(path)} exists or not depending on the disk, so the case wouldn't replay everywhere`,
      );
  });
  return problems;
}

// A waiting case's golden diff may be missing. Once it is there the case can
// run, so `waiting` has to go.
function loadGolden(
  evalCase: EvalCase,
  root: URL,
): { mutations: CapturedMutation[] | null } | { problems: string[] } {
  const named = evalCase.expect.find((e) => e.grader === "exact-diff");
  if (!named) return { mutations: null };
  const file = new URL(named.golden, root);
  if (evalCase.waiting !== undefined) {
    if (!existsSync(file)) return { mutations: null };
    return {
      problems: [`$.waiting: ${named.golden} is there now; remove waiting so the case runs`],
    };
  }
  const json = readJson(file);
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
