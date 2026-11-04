// An eval case is one JSON file, `<id>.json`: its split, its eval kind (SPEC
// §8's numbering), a frozen region from the fixtures, the prompt the user
// asks there, and its expectations, each naming the grader that checks it. A
// case passes when every expectation does.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  array,
  type CapturedMutation,
  type ChangeSetState,
  changeSetStates,
  type Infer,
  type Issue,
  type FixtureRegion,
  isInstant,
  isItemId,
  isNewRef,
  isUlid,
  type ItemId,
  literal,
  type NewRef,
  nullable,
  number,
  object,
  optional,
  agentNote,
  boolean,
  record,
  refine,
  type Result,
  string,
  type ThreadState,
  threadStates,
  union,
  unknown,
  type Validator,
} from "@oriel/core";
import { type Fixtures, itemNamed, regionNamed } from "./fixtures.ts";

// The eval kinds a case can be. Kinds 1 to 6 are deterministic; 7 and 8 are
// graded by an LLM judge. SPEC §8 also has kinds 1, 5 and 6, which no grader
// here can check, so no case may be one: binding correctness (1) and revert
// conflict (5) are unit tests of bindings and change sets, and latency (6)
// needs a timed, streaming test.
export const evalKinds = {
  2: "change-set completeness",
  3: "prompt injection",
  4: "tombstones",
  7: "summary faithfulness",
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

// An item as its fixture names it, `<kind>:<name>` (fixtures.ts), such as
// `jira:SYN-12` or `folder:meeting-notes.md`.
const itemName = refine(
  string,
  (name) => /^[a-z]{2,16}:./su.test(name),
  "expected an item as its fixture names it, like jira:SYN-12 or folder:notes.md",
);

// Each grader's expectation. `text` is quoted to the user as the content of
// `item`, and the reply names it as its fixture says a reply calls it, such
// as an issue by its key, a file by its title, or a Slack message by its
// author's name. `mentions` is text the reply contains, such as the name of
// a control in Oriel; `avoids`, text it doesn't. `claims` are a rubric for
// the judge, each one checkable on its own.

const expectations = {
  "exact-diff": object({ grader: literal("exact-diff"), golden: goldenPath }),
  "zero-mutations": object({ grader: literal("zero-mutations") }),
  // The calls a turn's intents apply as, in order, each on the case's own
  // workstream: an action and, for one that takes items, which.
  intents: object({
    grader: literal("intents"),
    calls: atLeastOne(object({ action: text, items: optional(atLeastOne(itemName)) })),
  }),
  // A block of `form` from `read`, or from one of them, was shown, and every
  // block shown is the one Oriel builds from what its read answered
  // (decision 0030).
  blocks: object({
    grader: literal("blocks"),
    form: union(literal("bars"), literal("table"), literal("rows"), literal("preview")),
    read: union(text, atLeastOne(text)),
  }),
  // What the turn drafted, held for the user (decision 0051): one draft of
  // `action` for the connection of each `kind`, whose options are `options`,
  // lists in any order.
  drafts: object({
    grader: literal("drafts"),
    calls: atLeastOne(object({ action: text, kind: text, options: record(unknown) })),
  }),
  // The turn never called sketch(), shown or refused (decision 0033): a
  // chart Oriel can build from a read is a block, never the agent's HTML.
  "no-sketch": object({ grader: literal("no-sketch") }),
  // The turn proposed slices (the scope-lab spike): every slice keeps each
  // of `keeps`; some slice defers each of `defers`; and each of `needs` is
  // there, an item needing `on` (an item, or words the need contains),
  // citing an item it was read in when `cited`. `none`: no slices at all.
  slices: object({
    grader: literal("slices"),
    keeps: optional(array(itemName)),
    defers: optional(array(itemName)),
    needs: optional(array(object({ item: itemName, on: text, cited: optional(boolean) }))),
  }),
  surfaced: object({ grader: literal("surfaced"), item: itemName, text: atLeastOne(text) }),
  mentions: object({ grader: literal("mentions"), text: atLeastOne(text) }),
  // Text the reply never contains, such as disowning Oriel's own line, or
  // sending the user to make a change by hand.
  avoids: object({ grader: literal("avoids"), text: atLeastOne(text) }),
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

// Oriel's own data in the case's workspace, as the agent's thread.* reads
// return it (decision 0024, OA-108): its threads, with what was said in each,
// and their change sets, with what each wrote where. IDs are fixed, so the
// links the agent writes replay.
const ulidText = refine(string, isUlid, "expected a ULID");
const instantText = refine(string, isInstant, "expected an instant");
const orielWorkspace = object({
  threads: atLeastOne(
    object({
      id: ulidText,
      name: text,
      state: refine(
        string,
        (state): state is ThreadState => (threadStates as readonly string[]).includes(state),
        `expected one of ${threadStates.join(", ")}`,
      ),
      workstream: object({ id: ulidText, name: text }),
      activityAt: instantText,
      said: array(text),
    }),
  ),
  changeSets: array(
    object({
      id: ulidText,
      thread: ulidText,
      state: refine(
        string,
        (state): state is ChangeSetState => (changeSetStates as readonly string[]).includes(state),
        `expected one of ${changeSetStates.join(", ")}`,
      ),
      createdAt: instantText,
      decided: nullable(
        object({
          kind: union(literal("approved"), literal("rejected")),
          by: text,
          at: instantText,
        }),
      ),
      changes: atLeastOne(object({ source: text, sentence: text, text: array(text) })),
    }),
  ),
});
export type OrielWorkspace = Infer<typeof orielWorkspace>;

// The region holds a fixture region's items, items any fixture names, or
// both.
const evalCaseShape = object({
  id: caseId,
  split,
  kind: evalKind,
  // A fixture's region by its name, such as one in fixtures/jira/regions.json.
  region: optional(text),
  // Items from any fixture, as it names them, such as a file before any
  // edit, or the name an edit renames one to.
  items: optional(atLeastOne(itemName)),
  // Oriel's own threads and change sets in the workspace. Absent: none.
  oriel: optional(orielWorkspace),
  // The case asks in the window chat (decision 0027): its region is empty,
  // its agent reads window.overview(), and the overview's workstreams hold
  // these fixture regions. Every fixture is connected, as in a window with
  // every source.
  // `at`: when the user looks, if not at the eval clock.
  window: optional(
    object({
      workstreams: array(object({ name: text, region: text })),
      at: optional(instantText),
    }),
  ),
  // What the thread said before the prompt, oldest first: the user's
  // messages, the agent's replies, and Oriel's own lines, such as asking
  // what was wrong with a rejected change set. Absent: a new thread.
  before: optional(
    atLeastOne(
      union(
        object({ role: union(literal("user"), literal("assistant")), text }),
        object({ role: literal("note"), note: agentNote }),
      ),
    ),
  ),
  // A window chat's connections whose options no longer fit their source,
  // by kind, with the options each has: they wait for their options, so the
  // module offers their preview and a draft of them (decision 0051). Their
  // items synced before stay in the index.
  unfit: optional(record(record(unknown))),
  // How many of each fixture's source edits are applied before the case
  // runs, by kind, such as `{ "jira": 3 }`. Absent means none.
  edited: optional(record(whole)),
  // Why the case can't run yet, such as a golden diff the maintainer hasn't
  // approved. It is checked and listed, never run.
  waiting: optional(text),
  // What the agent gets wrong here, as a live round found it: the one grader
  // it fails, and why. Failing that grader alone doesn't fail CI's replay;
  // failing any other, or passing, does.
  failing: optional(object({ grader: graderName, why: text })),
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
  const held = evalCase.region !== undefined || evalCase.items !== undefined;
  if (!held && evalCase.window === undefined)
    found.push({ path: "$", message: "a case's region needs a fixture region, items, or both" });
  if (held && evalCase.window !== undefined)
    found.push({ path: "$.window", message: "the window chat's region is empty" });
  const listed = evalCase.items ?? [];
  listed.forEach((entry, i) => {
    if (listed.indexOf(entry) !== i) found.push({ path: `$.items[${i}]`, message: "listed twice" });
  });
  // A note names a change set the workspace has.
  const sets = new Set(evalCase.oriel?.changeSets.map((set) => set.id));
  evalCase.before?.forEach((said, i) => {
    if (said.role === "note" && said.note.kind === "rejected" && !sets.has(said.note.changeSet))
      found.push({ path: `$.before[${i}].note.changeSet`, message: "no such change set in oriel" });
  });
  if (evalCase.unfit !== undefined && evalCase.window === undefined)
    found.push({ path: "$.unfit", message: "only the window chat drafts a connection's options" });
  if (evalCase.waiting !== undefined && evalCase.failing !== undefined)
    found.push({ path: "$.failing", message: "a waiting case never runs, so it can't be failing" });
  const graders = evalCase.expect.map((e) => e.grader);
  if (evalCase.failing && !graders.includes(evalCase.failing.grader))
    found.push({ path: "$.failing.grader", message: "the case expects nothing of that grader" });
  // CI never fails on a judged case's other graders, so a mark naming one
  // would make CI stricter than no mark.
  if (evalCase.failing && isJudged(evalCase.kind) && evalCase.failing.grader !== "judge")
    found.push({ path: "$.failing.grader", message: "a judged case is marked failing the judge" });
  graders.forEach((grader, i) => {
    if (graders.indexOf(grader) !== i)
      found.push({ path: `$.expect[${i}].grader`, message: "one expectation per grader" });
  });
  if (graders.includes("exact-diff") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "a golden diff and zero mutations contradict" });
  if (graders.includes("intents") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "intents and zero mutations contradict" });
  if (graders.includes("drafts") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "drafts and zero mutations contradict" });
  if (graders.includes("drafts") && evalCase.unfit === undefined)
    found.push({ path: "$.expect", message: "a draft needs a connection that waits (`unfit`)" });
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
  // The fixture region the case names, if any.
  region: FixtureRegion | null;
  // The items its region holds beside the fixture region's, by ID.
  items: ItemId[];
  // Each item the case names, by its name.
  named: ReadonlyMap<string, ItemId>;
  // The golden diff's mutations, when an expectation names one and the case
  // isn't waiting for it.
  golden: CapturedMutation[] | null;
};

// Reads every `*.json` in `dir` as a case, in file-name order, resolving each
// region and item against the fixtures and each golden diff against `root`.
// A missing `dir` holds no cases.
export function loadCases(
  dir: URL,
  fixtures: Fixtures,
  root: URL,
): { cases: LoadedCase[]; problems: string[] } {
  const cases: LoadedCase[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { cases, problems };
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files) {
    const found = loadCase(new URL(name, dir), name, fixtures, root);
    if ("problems" in found) problems.push(...found.problems.map((p) => `${name}: ${p}`));
    else cases.push(found);
  }
  return { cases, problems };
}

function loadCase(
  file: URL,
  name: string,
  fixtures: Fixtures,
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
  const held = holding(evalCase, fixtures);
  if ("problems" in held) problems.push(...held.problems);
  const golden = loadGolden(evalCase, root);
  if ("problems" in golden) problems.push(...golden.problems);
  if (problems.length || "problems" in held || "problems" in golden) return { problems };
  return { case: evalCase, ...held, golden: golden.mutations };
}

// What a case's region holds, from the fixtures, and every item it names:
// each one its fixture can hold.
export function holding(
  evalCase: EvalCase,
  fixtures: Fixtures,
): Pick<LoadedCase, "region" | "items" | "named"> | { problems: string[] } {
  const problems: string[] = [];
  const regionName = evalCase.region;
  const region = regionName === undefined ? null : regionNamed(fixtures, regionName);
  if (region === undefined)
    problems.push(`$.region: no fixture region named ${JSON.stringify(regionName)}`);
  evalCase.window?.workstreams.forEach((workstream, i) => {
    if (!regionNamed(fixtures, workstream.region))
      problems.push(`$.window.workstreams[${i}].region: no fixture region by that name`);
  });
  for (const [kind, edited] of Object.entries(evalCase.edited ?? {})) {
    const fixture = fixtures.get(kind);
    const at = `$.edited[${JSON.stringify(kind)}]`;
    if (!fixture) problems.push(`${at}: no ${kind} fixture is loaded`);
    else if (edited > fixture.loaded.edits)
      problems.push(`${at}: the ${kind} fixture has ${fixture.loaded.edits} edits`);
  }
  const named = new Map<string, ItemId>();
  const resolve = (item: string, path: string): ItemId | null => {
    const found = itemNamed(fixtures, item);
    if ("problem" in found) {
      problems.push(`${path}: ${found.problem}`);
      return null;
    }
    named.set(item, found.id);
    return found.id;
  };
  const items = (evalCase.items ?? []).flatMap((item, i) => resolve(item, `$.items[${i}]`) ?? []);
  const held = new Set<string>([...(region?.items ?? []), ...items]);
  evalCase.expect.forEach((e, i) => {
    if (e.grader === "intents")
      e.calls.forEach((call, c) =>
        call.items?.forEach((item, n) => resolve(item, `$.expect[${i}].calls[${c}].items[${n}]`)),
      );
    if (e.grader === "slices") {
      e.keeps?.forEach((item, n) => resolve(item, `$.expect[${i}].keeps[${n}]`));
      e.defers?.forEach((item, n) => resolve(item, `$.expect[${i}].defers[${n}]`));
      e.needs?.forEach((need, n) => resolve(need.item, `$.expect[${i}].needs[${n}].item`));
    }
    if (e.grader !== "surfaced") return;
    const id = resolve(e.item, `$.expect[${i}].item`);
    // The window chat's overview shows what no workstream holds yet. A
    // region that isn't there holds nothing to check against.
    if (id && region !== undefined && !evalCase.window && !held.has(id))
      problems.push(`$.expect[${i}].item: not an item the case's region holds`);
  });
  if (problems.length || region === undefined) return { problems };
  return { region, items, named };
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
