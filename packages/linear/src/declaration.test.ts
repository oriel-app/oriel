// Linear's declaration (OA-278): its fixture connects through the stand-in
// of its server, its namespace offers nothing while it's off and Linear's
// words while it's on, its recognizer finds its team's issues, and its
// panel shows Linear's own extras.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ItemId, type NamespaceHost, type NamespaceWrite } from "@oriel/core";
import { linearDeclaration } from "./declaration.ts";

const loaded = linearDeclaration.fixture.load();

async function world() {
  const connected = await loaded.connect(0);
  const kinds = new Map(connected.records.map((record) => [record.id, record.facets.kind]));
  return { connected, kinds };
}

test("its fixture holds Ferrowick's launch, frozen, with a region that holds an issue deleted since", async () => {
  const { connected } = await world();
  assert.equal(connected.records.length, 24);
  assert.deepEqual(loaded.item("ENG-4"), { id: "linear:ENG-4" });
  assert.deepEqual(loaded.item("P-5e2a9c41b7d0"), { id: "linear:P-5e2a9c41b7d0" });
  assert.ok("problem" in loaded.item("ENG-99"));
  const region = loaded.regions.find((each) => each.name === "with-deleted");
  assert.deepEqual(region?.items, ["linear:ENG-19", "linear:ENG-99"]);
  const [gone] = await connected.read(["linear:ENG-99" as ItemId]);
  assert.equal(gone?.status, "gone");
  assert.equal(
    [...loaded.chips(0)].find(([id]) => id === "linear:ENG-4")?.[1],
    "ENG-4 Alert passengers whose booked sailing moves",
  );
  assert.equal(connected.context?.now, "2026-11-05T16:40:00.000Z");
});

test("off, its namespace offers nothing: what Linear can't apply, the agent can't propose", () => {
  const spec = linearDeclaration.namespace([], undefined);
  assert.deepEqual(spec.fns({ ids: [], anchor: null }), []);
  assert.deepEqual(spec.types({ ids: [], anchor: null }), []);
});

const host = (ids: readonly string[]): NamespaceHost =>
  ({ has: (id: string) => ids.includes(id), created: new Map() }) as unknown as NamespaceHost;
const build = (fn: NamespaceWrite | undefined, values: unknown[], ids: readonly string[]) => {
  assert.ok(fn);
  return fn.build(values as never, host(ids));
};

test("on, a project's region creates issues in it, in the team's cycles to come, and moves them through its workflow", async () => {
  const { connected, kinds } = await world();
  const spec = linearDeclaration.namespace(connected.records, connected.context);
  const ids = ["linear:P-5e2a9c41b7d0", "linear:ENG-2", "linear:ENG-4"] as ItemId[];
  const scope = { ids, anchor: "linear:P-5e2a9c41b7d0" as ItemId };
  const fns = spec.fns(scope);
  assert.deepEqual(
    fns.map((fn) => fn.name),
    [
      "getItem",
      "listItems",
      "team",
      "createIssue",
      "setTitle",
      "setDescription",
      "setEstimate",
      "setAssignee",
      "setStatus",
      "setCycle",
      "addLabel",
    ],
  );
  const types = spec.types(scope).join("\n");
  // Cycles by number and date; no status's or cycle's name, which are the
  // source's text, reaches the declarations: team() gives them.
  assert.match(
    types,
    /ENG's cycles to come, by number: 13 is under way until 2026-11-16; 14 starts 2026-11-16/,
  );
  assert.doesNotMatch(types, /Timetable freeze|In Review|Triage/);
  const team = (await (
    fns.find((fn) => fn.name === "team") as { run: (v: [], h: never) => Promise<unknown> }
  ).run([], {} as never)) as { statuses: { name: string }[]; cycles: { name: string | null }[] };
  assert.deepEqual(
    team.statuses.map((each) => each.name),
    ["Triage", "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"],
  );
  assert.ok(team.cycles.some((each) => each.name === "Timetable freeze"));
  assert.match(types, /type LinearCycle = 13 \| 14;/);
  const write = (name: string) => fns.find((fn) => fn.name === name) as NamespaceWrite;
  // As stored: what's left out is absent.
  const stored = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
  assert.deepEqual(stored(build(write("createIssue"), [{ title: "Ferry map", cycle: 14 }], ids)), {
    target: null,
    args: { title: "Ferry map", cycle: 14, project: "linear:P-5e2a9c41b7d0" },
  });
  assert.throws(() => build(write("setCycle"), ["linear:ENG-2", 12], ids), /cycles to come/);
  assert.throws(() => build(write("setStatus"), ["linear:ENG-2", "Shipped"], ids), /statuses/);
  assert.deepEqual(build(write("setStatus"), ["linear:ENG-2", "In Review"], ids), {
    target: "linear:ENG-2",
    args: { status: "In Review" },
  });
  assert.equal(kinds.get("linear:P-5e2a9c41b7d0"), "epic");
});

test("on, a blank region creates a project, and issues in it or in none", async () => {
  const { connected } = await world();
  const spec = linearDeclaration.namespace(connected.records, connected.context);
  const fns = spec.fns({ ids: [], anchor: null });
  assert.deepEqual(
    fns.map((fn) => fn.name),
    ["createProject", "createIssue"],
  );
  assert.equal(spec.blank, true);
});

test("its recognizer finds its team's issues in any text, and nothing of another team's", () => {
  const recognize = linearDeclaration.recognizer({ team: "ENG" });
  assert.deepEqual(recognize("See ENG-4 and ENG-12, not OPS-1 or ENG-0, and ENG-4 again"), [
    "linear:ENG-4",
    "linear:ENG-12",
  ]);
});

test("its panel shows an issue's team, project, cycle and parent, and its description as markdown", async () => {
  const { connected } = await world();
  const [read] = await connected.read(["linear:ENG-5" as ItemId]);
  assert.ok(read?.status === "ok");
  const panel = linearDeclaration.panel(read.content);
  const facts = panel?.blocks[0];
  assert.ok(facts?.kind === "facts");
  assert.deepEqual(
    facts.facts.map((fact) => `${fact.name}: ${fact.value}`),
    [
      "Type: Sub-issue",
      "Status: Todo",
      "Assignee: Ines Carvalho",
      "Estimate: 1 point",
      "Labels: notifications",
      "Team: ENG",
      "Project: Summer timetable launch",
      "Cycle: Cycle 13, Timetable freeze",
      "Parent: ENG-4",
    ],
  );
  assert.equal(panel?.blocks[1]?.kind === "text" && panel.blocks[1].format, "markdown");
});
