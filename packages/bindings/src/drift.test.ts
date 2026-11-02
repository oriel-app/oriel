// The declarations, the stubs and the host come from one description. These
// tests hold them together: the stubs typecheck against the declarations, a
// sample script typechecks against them too, and the same script, run through
// the stubs, is answered and captured by the host.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "./bindings.ts";
import { describe, type Fn, globals, scopeOf } from "./describe.ts";
import { stubs } from "./shim.ts";
import {
  fixture,
  fixtureReader,
  fixtureRegion,
  namespaces,
  pickedWithEpic,
  runGuest,
  snapshotAfter,
} from "./testing.ts";
import { compile, typecheck } from "./typecheck.ts";

const reader = fixtureReader(snapshotAfter(fixture.edits.length));

// The declarations, verbatim, made a module by one appended export line, so
// their globals can't stand in for a missing stub.
const declaredModule = (dts: string) =>
  `${dts}export type Declared = { jira: typeof jira; search: typeof search; NewRef: NewRef };\n`;

// The stubs as a module, with `__oriel` declared as loosely as the runtime is
// typed: a read resolves to anything, a create returns a NewRef and any other
// write returns nothing. Each namespace must be assignable to what the
// declarations say, with exactly the same names.
const stubModule = (text: string) =>
  [
    "import type { Declared } from './region.js';",
    "declare const __oriel: {",
    "  read(fn: string, args: unknown[]): Promise<never>;",
    "  write(fn: string, args: unknown[], creates: true): Declared['NewRef'];",
    "  write(fn: string, args: unknown[], creates: false): void;",
    "  intend(fn: string, args: unknown[]): void;",
    "};",
    text,
    "type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;",
    "export const declaredJira: Declared['jira'] = jira;",
    "export const declaredSearch: Declared['search'] = search;",
    "export const sameNames: Same<keyof typeof jira, keyof Declared['jira']> = true;",
  ].join("\n");

async function checkStubs(dts: string, fns: readonly Fn[]) {
  const checked = await compile(
    { "region.d.ts": declaredModule(dts), "stubs.ts": stubModule(stubs(fns)) },
    { timeoutMs: 10_000 },
  );
  assert.equal(checked.kind, "checked");
  return checked.kind === "checked" ? checked.diagnostics : [];
}

const regions = [
  ["boarding-epic", fixtureRegion("boarding-epic")],
  ["picked", fixtureRegion("picked")],
  ["picked with an epic", pickedWithEpic()],
] as const;

for (const [name, region] of regions) {
  test(`${name}: the stubs typecheck against the declarations`, async () => {
    const bindings = bindingsFor(region, { reader, namespaces });
    const fns = describe(scopeOf(region, namespaces));
    const start = `__oriel.start({ ${globals.join(", ")} });\n`;
    assert.ok(bindings.shim.endsWith(stubs(fns) + start), "the shim ends with these stubs");
    assert.deepEqual(await checkStubs(bindings.dts, fns), []);
  });
}

test("every function lives under a name the guest hands the script, and each name is used", () => {
  for (const [, region] of regions) {
    const homes = new Set(describe(scopeOf(region, namespaces)).map((fn) => fn.space ?? fn.name));
    // Every name but a namespace for a source the region holds nothing from,
    // which the guest still hands the script, empty.
    const unused = globals.filter((name) => !homes.has(name));
    assert.deepEqual(unused, ["folder", "slack"]);
    assert.ok([...homes].every((home) => (globals as readonly string[]).includes(home)));
  }
});

test("the stub check catches a missing, extra, renamed or mis-kinded stub", async () => {
  const region = fixtureRegion("boarding-epic");
  const { dts } = bindingsFor(region, { reader, namespaces });
  const fns = describe(scopeOf(region, namespaces));
  const write = fns.find((fn) => fn.name === "setSummary");
  assert.ok(write);
  // Each drift, and the diagnostic codes it must produce.
  const drifted: [string, Fn[], number[]][] = [
    ["missing", fns.filter((fn) => fn.name !== "addLink"), [2741, 2322]],
    [
      "renamed",
      fns.map((fn) => (fn.name === "addLink" ? { ...fn, name: "addLinks" } : fn)),
      [2741, 2322],
    ],
    ["extra", [...fns, { ...write, name: "setTitle" }], [2322]],
    [
      "create as plain write",
      fns.map((fn) => (fn.kind === "write" && fn.creates ? { ...fn, creates: false } : fn)),
      [2322],
    ],
    [
      "read as write",
      fns.map((fn) => (fn.name === "getItem" ? { ...write, name: "getItem" } : fn)),
      [2322],
    ],
    ["no global", fns.filter((fn) => fn.name !== "search"), [2304]],
  ];
  for (const [drift, list, codes] of drifted) {
    const diagnostics = await checkStubs(dts, list);
    assert.deepEqual(
      diagnostics.map((d) => [d.file, d.code]),
      codes.map((code) => ["stubs.ts", code]),
      drift,
    );
  }
});

const epicScript = `
const epic = await jira.getEpic();
const stories = await jira.listStories();
const live = stories.flatMap((s) => (s.gone ? [] : [s]));
const tombstones = stories.filter((s) => s.gone).map((s) => s.id);
const unestimated = live.filter((s) => s.points === null);
for (const s of unestimated) jira.setEstimate(s.id, 3);
const ref: NewRef = jira.createStory({ summary: "Retry boarding scans offline", points: 2 });
jira.setDescription(ref, "Queue scans while the gate is offline.");
jira.addLink(ref, "https://example.com/runbook", "Runbook");
console.log("unestimated", unestimated.length);
const found = await search("checkout", 2);
return {
  epic: epic.gone ? null : epic.issueType,
  tombstones,
  unestimated: unestimated.map((s) => s.id),
  fields: live.map((s) => [s.summary, s.description, s.status.category, s.epic, s.assignee?.accountId ?? null, s.labels.length, s.comments.length, s.links.length]),
  found: found.map((f) => f.id),
  ref,
};
`;

test("a sample script typechecks against an epic region's declarations and runs through the stubs", async () => {
  const region = fixtureRegion("boarding-epic");
  const bindings = bindingsFor(region, { reader, namespaces });
  assert.equal(await typecheck(epicScript, bindings.dts), null);

  const run = await runGuest(bindings, epicScript);
  assert.equal(run.stderr, "");
  assert.deepEqual(run.rejected, []);
  assert.deepEqual(
    run.reads.map((read) => [read.fn, read.outsideRegion]),
    [
      ["jira.getEpic", false],
      ["jira.listStories", false],
      ["search", true],
    ],
  );
  assert.deepEqual(run.logs, ["unestimated 3"]);
  assert.equal(run.outcome?.kind, "done");
  const value = run.outcome?.kind === "done" ? (run.outcome.value as Record<string, unknown>) : {};
  assert.equal(value.epic, "Epic");
  assert.deepEqual(value.tombstones, ["jira:SYN-27"]);
  assert.equal(value.ref, "new:1");
  const issues = new Map(fixture.issues.map((issue) => [`jira:${issue.key}`, issue]));
  const fields = value.fields as unknown[][];
  assert.equal(fields.length, region.items.length - 2, "all but the epic and the tombstone");
  for (const [summary, description] of fields)
    assert.ok(
      [...issues.values()].some((i) => i.summary === summary && i.description === description),
    );

  const estimates = (value.unestimated as string[]).map((id) => ({
    op: "setEstimate",
    target: id,
    ref: null,
    args: { points: 3 },
  }));
  assert.deepEqual(run.mutations, [
    ...estimates,
    {
      op: "createStory",
      target: null,
      ref: "new:1",
      args: { summary: "Retry boarding scans offline", points: 2, epic: "jira:SYN-2" },
    },
    {
      op: "setDescription",
      target: "new:1",
      ref: null,
      args: { description: "Queue scans while the gate is offline." },
    },
    {
      op: "addLink",
      target: "new:1",
      ref: null,
      args: { url: "https://example.com/runbook", title: "Runbook" },
    },
  ]);
});

const pickedScript = `
const items = await jira.listItems();
const ref = jira.createStory({ summary: "Split the refund flow" });
jira.setAssignee(ref, null);
jira.setSummary("jira:SYN-80", "Refunds: one flow");
try {
  await jira.getItem("jira:SYN-1" as RegionId);
} catch (error) {
  console.error(error);
}
return items.map((item) => (item.gone ? item.reason : item.id));
`;

test("a sample script typechecks against a picked region's declarations and runs through the stubs", async () => {
  const bindings = bindingsFor(fixtureRegion("picked"), { reader, namespaces });
  assert.equal(await typecheck(pickedScript, bindings.dts), null);

  const run = await runGuest(bindings, pickedScript);
  assert.equal(run.stderr, "");
  assert.deepEqual(run.rejected, []);
  assert.deepEqual(run.logs, [
    `Error: jira.getItem: "jira:SYN-1" isn't in this region; use search() to look outside it`,
  ]);
  assert.deepEqual(run.outcome, {
    kind: "done",
    value: ["jira:SYN-13", "deleted", "jira:SYN-80", "jira:SYN-103", "jira:SYN-104"],
  });
  assert.deepEqual(
    run.mutations.map((m) => [m.op, m.target, m.ref, m.args]),
    [
      ["createStory", null, "new:1", { summary: "Split the refund flow", epic: null }],
      ["setAssignee", "new:1", null, { accountId: null }],
      ["setSummary", "jira:SYN-80", null, { summary: "Refunds: one flow" }],
    ],
  );
});

test("a new story's epic is typed: only the region's epics, where it has any", async () => {
  const picked = bindingsFor(fixtureRegion("picked"), { reader, namespaces });
  const withEpic = bindingsFor(pickedWithEpic(), { reader, namespaces });
  const into = (epic: string) => `jira.createStory({ summary: "A", epic: "${epic}" });`;
  assert.equal(await typecheck(into("jira:SYN-1"), withEpic.dts), null);
  assert.match((await typecheck(into("jira:SYN-13"), withEpic.dts))?.message ?? "", /TS2322/);
  assert.match((await typecheck(into("jira:SYN-1"), picked.dts))?.message ?? "", /TS2353/);
});

test("console takes new properties, but its log methods can't be replaced", async () => {
  const bindings = bindingsFor(fixtureRegion("picked"), { reader, namespaces });
  const script = `
const open = console as unknown as Record<string, unknown>;
open._stdout = "added";
const attempt = (change: () => void) => {
  try {
    change();
    return "changed";
  } catch {
    return "refused";
  }
};
const tries = ["log", "error"].flatMap((name) => [
  attempt(() => { open[name] = () => {}; }),
  attempt(() => { Object.defineProperty(console, name, { value: () => {} }); }),
  attempt(() => { delete open[name]; }),
]);
console.log("still ours");
return { added: open._stdout, extensible: Object.isExtensible(console), tries };
`;
  const run = await runGuest(bindings, script);
  assert.equal(run.stderr, "");
  assert.deepEqual(run.logs, ["still ours"]);
  assert.deepEqual(run.outcome, {
    kind: "done",
    value: { added: "added", extensible: true, tries: Array(6).fill("refused") },
  });
});

test("logged errors, maps and sets show what they hold, within bounds", async () => {
  const bindings = bindingsFor(fixtureRegion("picked"), { reader, namespaces });
  const script = `
console.log(new Map([["jira:SYN-13", 3]]), new Set(["a"]), { error: new RangeError("deep") });
console.log("x".repeat(5000));
return null;
`;
  const run = await runGuest(bindings, script);
  assert.deepEqual(
    run.logs.map((log) => log.slice(0, 80)),
    [
      `{"Map(1)":[["jira:SYN-13",3]]} {"Set(1)":["a"]} {"error":"RangeError: deep"}`,
      "x".repeat(80),
    ],
  );
  assert.equal(run.logs[1]?.length, 4001);
});

test("the guest reports a throw, and the host refuses a write the types would have caught", async () => {
  const bindings = bindingsFor(fixtureRegion("picked"), { reader, namespaces });
  const script = `
jira.setEstimate("jira:SYN-1" as RegionId, 1);
const item = await jira.getItem("jira:SYN-13");
if (!item.gone) (item as { points: number | null }).points = 1;
return 1;
`;
  const run = await runGuest(bindings, script);
  assert.deepEqual(run.rejected, [
    `jira.setEstimate: "jira:SYN-1" isn't in this region; writes take only its IDs and refs from createStory`,
  ]);
  assert.equal(run.outcome?.kind, "threw", "read results are frozen");
  assert.match(run.outcome?.kind === "threw" ? run.outcome.message : "", /read only|read-only/);
});
