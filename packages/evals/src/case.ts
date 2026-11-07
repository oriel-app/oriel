// An eval case is one JSON file, `<id>.json`: its split, its eval kind (SPEC
// §8's numbering), a frozen region from the fixtures, the prompt the user
// asks there, and its expectations, each naming the grader that checks it. A
// case passes when every expectation does.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  blockForms,
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
import { throughServers } from "./through.ts";

// The eval kinds a case can be. Kinds 1 to 6 are deterministic; 7 and 8 are
// graded by an LLM judge. SPEC §8 also has kinds 1, 5 and 6, which no grader
// here can check, so no case may be one: binding correctness (1) and revert
// conflict (5) are unit tests of bindings and change sets, and latency (6)
// needs a timed, streaming test. Kind 9, a second look at a change set (the
// decision 0054), is deterministic: what the look kept, from a diff the
// case gives.
export const evalKinds = {
  2: "change-set completeness",
  3: "prompt injection",
  4: "tombstones",
  7: "summary faithfulness",
  8: "scope discipline",
  9: "second look",
} as const;
export type EvalKind = keyof typeof evalKinds;

export const isJudged = (kind: number) => kind === 7 || kind === 8;

const blockFormValue = union(...[...blockForms, "preview" as const].map((form) => literal(form)));
const text = refine(string, (value) => value.trim() !== "", "expected non-empty text");
const whole = refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a whole number");
const atLeastOne = <T>(item: Validator<T>) =>
  refine(array(item), (items) => items.length > 0, "expected at least one");

const findingKind = union(
  literal("conflict"),
  literal("discussion"),
  literal("companion"),
  literal("related"),
);

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
  "expected an eval kind with a grader: 2, 3, 4, 7, 8 or 9",
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
  // workstream: an action and, for one that takes items, which; and the
  // input's other fields it must have, such as the kind it turns off.
  intents: object({
    grader: literal("intents"),
    calls: atLeastOne(
      object({ action: text, items: optional(atLeastOne(itemName)), with: optional(record(text)) }),
    ),
  }),
  // A plan from nothing: the run's mutations are creates into `kind` alone,
  // `epics` epics and from `stories.atLeast` to `stories.atMost` stories,
  // each story in an epic the run created, and nothing else.
  creates: object({
    grader: literal("creates"),
    kind: text,
    epics: whole,
    stories: object({ atLeast: whole, atMost: whole }),
  }),
  // The mutations the run captured, in any order: one of each `op` on
  // `item`, whose text arguments hold every one of `text`, ignoring case;
  // and no other, so a note that should be a comment can't also rewrite a
  // description.
  writes: object({
    grader: literal("writes"),
    calls: atLeastOne(object({ op: text, item: itemName, text: optional(atLeastOne(text)) })),
  }),
  // A block of `form` from `read`, or from one of them, was shown, and every
  // block shown is the one Oriel builds from what its read answered
  // (decision 0030).
  // `form` may name several, any of which passes.
  blocks: object({
    grader: literal("blocks"),
    form: union(blockFormValue, atLeastOne(blockFormValue)),
    read: union(text, atLeastOne(text)),
  }),
  // What the turn drafted, held for the user (decision 0051): one draft of
  // `action` for the connection of each `kind`, whose options are `options`,
  // lists in any order; or that hold what `golden` does, a file of
  // `{ "options": … }` (see `holds` in graders.ts).
  drafts: object({
    grader: literal("drafts"),
    calls: atLeastOne(
      refine(
        object({
          action: text,
          kind: text,
          options: optional(record(unknown)),
          golden: optional(goldenPath),
        }),
        (call) => (call.options === undefined) !== (call.golden === undefined),
        "expected options or a golden, not both",
      ),
    ),
  }),
  // The turn never called sketch(), shown or refused (decision 0033): a
  // chart Oriel can build from a read is a block, never the agent's HTML.
  "no-sketch": object({ grader: literal("no-sketch") }),
  // Oriel refused none of the turn's show() calls: the agent asked for its
  // blocks right the first time, without guessing at the spec.
  "no-refused-block": object({ grader: literal("no-refused-block") }),
  surfaced: object({ grader: literal("surfaced"), item: itemName, text: atLeastOne(text) }),
  mentions: object({ grader: literal("mentions"), text: atLeastOne(text) }),
  // Text the reply never contains, such as disowning Oriel's own line, or
  // sending the user to make a change by hand.
  avoids: object({ grader: literal("avoids"), text: atLeastOne(text) }),
  judge: object({ grader: literal("judge"), claims: atLeastOne(text) }),
  // What a second look kept (kind 9): a finding resting on a quote from each
  // item `cites` names, of one of its `kinds` when given, and at most
  // `atMost` findings in all.
  findings: object({
    grader: literal("findings"),
    cites: optional(
      atLeastOne(object({ item: itemName, kinds: optional(atLeastOne(findingKind)) })),
    ),
    atMost: optional(whole),
  }),
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
  // The kinds the case's window hasn't connected, as a fresh first run's has
  // none: their fixtures don't connect, even ones every case connects, and a
  // stand-in for them is on (decision 0059). Absent: none.
  off: optional(atLeastOne(text)),
  // The kinds the case's window has on through their source server, which a
  // stand-in of it answers in memory: their sync and reads go through the
  // connector's parser (decision 0059). Absent: none.
  servers: optional(atLeastOne(text)),
  // Eight weeks of past in the change log (past-weeks.ts), for history().
  past: optional(literal(true)),
  // Why the case can't run yet, such as a golden diff the maintainer hasn't
  // approved. It is checked and listed, never run.
  waiting: optional(text),
  // What the agent gets wrong here, as a live round found it: the one grader
  // it fails, and why. Failing that grader alone doesn't fail CI's replay;
  // failing any other, or passing, does.
  failing: optional(object({ grader: graderName, why: text })),
  // What the user asks; a second look has none, since Oriel asks.
  prompt: optional(text),
  // A second look at a change set (kind 9): its diff as Oriel computes it,
  // one line per change, each item as its fixture names it. The look runs
  // with no history, on Oriel's fixed ask.
  challenge: optional(
    object({
      lines: atLeastOne(
        object({
          change: text,
          item: nullable(itemName),
          fields: array(object({ name: text, before: unknown, after: unknown })),
        }),
      ),
    }),
  ),
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
  if (graders.includes("writes") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "writes and zero mutations contradict" });
  if (graders.includes("creates") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "creates and zero mutations contradict" });
  if (graders.includes("drafts") && graders.includes("zero-mutations"))
    found.push({ path: "$.expect", message: "drafts and zero mutations contradict" });
  if (graders.includes("drafts") && evalCase.unfit === undefined)
    found.push({ path: "$.expect", message: "a draft needs a connection that waits (`unfit`)" });
  const looks = evalCase.challenge !== undefined;
  if (looks !== (evalCase.kind === 9))
    found.push({ path: "$.kind", message: "a second look (`challenge`) is kind 9, and only it" });
  if (looks === (evalCase.prompt !== undefined))
    found.push({ path: "$.prompt", message: "a case asks a prompt, unless it is a second look" });
  if (looks && !graders.includes("findings"))
    found.push({ path: "$.expect", message: "a second look is graded by what it found" });
  if (!looks && graders.includes("findings"))
    found.push({ path: "$.expect", message: "only a second look has findings" });
  const judged = isJudged(evalCase.kind);
  if (judged && !graders.includes("judge"))
    found.push({ path: "$.expect", message: "kinds 7 and 8 are graded by the judge" });
  if (!judged && graders.includes("judge"))
    found.push({ path: "$.expect", message: "kinds 2 to 4 are deterministic: no judge" });
  // In an onboarding turn, where a connection waits for its options, the
  // draft is the turn's work, and it must hold a golden that ignores what
  // the injection asks (decision 0051).
  const onboarding =
    evalCase.unfit !== undefined &&
    evalCase.expect.some(
      (e) => e.grader === "drafts" && e.calls.every((call) => call.golden !== undefined),
    );
  if (
    evalCase.kind === 3 &&
    !onboarding &&
    !(graders.includes("zero-mutations") && graders.includes("surfaced"))
  )
    found.push({
      path: "$.expect",
      message:
        "an injection case expects zero mutations and surfaced text, or, onboarding, a draft that holds a golden",
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
  into: optional(text),
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
  const drafts = loadDraftGoldens(evalCase, root);
  if ("problems" in drafts) problems.push(...drafts.problems);
  if (problems.length || "problems" in held || "problems" in golden || "problems" in drafts)
    return { problems };
  return { case: drafts.case, ...held, golden: golden.mutations };
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
  (evalCase.servers ?? []).forEach((kind, i) => {
    if (!Object.hasOwn(throughServers, kind))
      problems.push(`$.servers[${i}]: ${kind} has no source server a case can reach`);
  });
  (evalCase.off ?? []).forEach((kind, i) => {
    if (!fixtures.has(kind)) problems.push(`$.off[${i}]: no ${kind} fixture is loaded`);
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
  evalCase.challenge?.lines.forEach((line, i) => {
    if (line.item !== null) resolve(line.item, `$.challenge.lines[${i}].item`);
  });
  evalCase.expect.forEach((e, i) => {
    if (e.grader === "findings")
      e.cites?.forEach((cite, c) => resolve(cite.item, `$.expect[${i}].cites[${c}].item`));
    if (e.grader === "intents")
      e.calls.forEach((call, c) =>
        call.items?.forEach((item, n) => resolve(item, `$.expect[${i}].calls[${c}].items[${n}]`)),
      );
    if (e.grader === "writes")
      e.calls.forEach((call, c) => resolve(call.item, `$.expect[${i}].calls[${c}].item`));
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

// A golden draft: the options a draft must hold.
const goldenDraft = object({ options: record(unknown) });

// Each drafts expectation's goldens, read into its `options`, which a draft
// must then hold rather than equal, so the case's content, which cassettes
// are keyed by, includes them.
function loadDraftGoldens(
  evalCase: EvalCase,
  root: URL,
): { case: EvalCase } | { problems: string[] } {
  const problems: string[] = [];
  const expect = evalCase.expect.map((expectation) => {
    if (expectation.grader !== "drafts") return expectation;
    const calls = expectation.calls.map((call) => {
      if (call.golden === undefined) return call;
      const json = readJson(new URL(call.golden, root));
      const parsed = json.ok ? goldenDraft(json.value) : null;
      if (!json.ok) problems.push(`${call.golden}: ${json.error}`);
      else if (parsed && !parsed.ok)
        problems.push(...parsed.issues.map((i) => `${call.golden}: ${format(i)}`));
      return parsed?.ok ? { ...call, options: parsed.value.options } : call;
    });
    return { ...expectation, calls };
  });
  return problems.length ? { problems } : { case: { ...evalCase, expect } };
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
