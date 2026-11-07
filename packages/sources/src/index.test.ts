import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browseColumns,
  connectorIcons,
  type IndexRecord,
  instant,
  type Shape,
  settingNames,
} from "@oriel/core";
import {
  byItemId,
  connectorViews,
  itemDocs,
  namespacesFor,
  namespacesOf,
  parseDeclared,
  sourceKinds,
  sources,
  specs,
} from "./index.ts";

test("every source kind declares its name and what its items are, in source order", () => {
  assert.deepEqual(Object.keys(sources).toSorted(), [...sourceKinds].toSorted());
  assert.deepEqual(Object.keys(itemDocs), [...sourceKinds]);
  for (const kind of sourceKinds) {
    assert.ok(sources[kind].name.length > 0, kind);
    assert.equal(itemDocs[kind], sources[kind].itemDoc);
  }
});

test("each source is listed under the kind it declares, a short lowercase word", () => {
  for (const kind of sourceKinds) {
    assert.equal(sources[kind].kind, kind);
    assert.match(kind, /^[a-z]{2,16}$/);
  }
});

test("the window gets how each connector shows, in declared order, with nothing else", () => {
  // Words and step kinds, never a step's server half.
  assert.deepEqual(
    connectorViews.map((view) => view.kind),
    [...sourceKinds],
  );
  for (const view of connectorViews) {
    assert.deepEqual(Object.keys(view).toSorted(), [
      "columns",
      "connect",
      "icon",
      "inSentence",
      "keysReadAs",
      "kind",
      "name",
      "options",
      "standIn",
      "writable",
    ]);
    assert.deepEqual(
      Object.keys(view.connect ?? {}).toSorted(),
      view.connect ? ["offer", "steps"] : [],
    );
    assert.ok(view.inSentence.length > 0, view.kind);
    assert.ok(connectorIcons.includes(view.icon), view.kind);
    assert.ok(view.keysReadAs === null || view.keysReadAs.length > 0, view.kind);
  }
  // It goes to the page as JSON: nothing in it is lost on the way.
  assert.deepEqual(JSON.parse(JSON.stringify(connectorViews)), connectorViews);
});

test("each Browse column a connector fills, but the assignee, is a facet it declares", () => {
  for (const kind of sourceKinds) {
    const { columns, facets } = sources[kind];
    assert.equal(new Set(columns).size, columns.length, kind);
    for (const column of columns) {
      assert.ok(browseColumns.includes(column), `${kind}: ${column}`);
      if (column !== "assignee") assert.ok(Object.hasOwn(facets, column), `${kind}: ${column}`);
    }
  }
});

test("each kind's keys have its declared shape, stricter than core's", () => {
  const good = [
    "jira:SYN-12",
    "jira.2:ACME-4",
    "folder:0123456789abcdef",
    "slack:C0A1B2C3D-1759309200.000100",
    "linear:ENG-4",
    "linear:P-5e2a9c41b7d0",
  ];
  for (const id of good) assert.ok(parseDeclared(id), id);
  assert.deepEqual(parseDeclared("jira.2:ACME-4"), {
    kind: "jira",
    prefix: "jira.2",
    key: "ACME-4",
  });
  const bad = [
    "slack:C1",
    "jira:syn-1",
    "jira:SYN-0",
    "folder:plan.md",
    "folder:0123456789ABCDEF",
    "folder:0123456789abcde",
    "folder:0123456789abcdef0",
    "sheets:anything",
    "linear:eng-4",
    "linear:ENG-0",
    "linear:P-5E2A9C41B7D0",
    "linear:P-summer-timetable-launch",
  ];
  for (const id of bad) assert.equal(parseDeclared(id), null, id);
});

test("Linear is declared right after Jira, and the stand-in tracker last", () => {
  // An untagged create, from before migration 0031, goes to the first kind
  // whose catalogue has its op: Jira's creates stay Jira's, and Linear's
  // creates are its own.
  assert.deepEqual(sourceKinds.slice(0, 2), ["jira", "linear"]);
  assert.equal(sourceKinds.at(-1), "tracker");
  const first = (op: string) => sourceKinds.find((kind) => specs[kind]?.ops[op]);
  assert.equal(first("createEpic"), "jira");
  assert.equal(first("createStory"), "jira");
  assert.equal(first("createIssue"), "linear");
  assert.equal(first("createProject"), "linear");
});

test("item IDs order by the declared kinds", () => {
  const ids = ["slack:C0A1B2C3D-1759309200.000100", "folder:0123456789abcdef", "jira:SYN-2"];
  assert.deepEqual(ids.toSorted(byItemId), [
    "jira:SYN-2",
    "folder:0123456789abcdef",
    "slack:C0A1B2C3D-1759309200.000100",
  ]);
});

test("only a source that declares a namespace gets one, and op specs likewise", () => {
  const namespaces = namespacesFor([], { jira: { none: new Set(), home: null } });
  const declaring = sourceKinds.filter((kind) => sources[kind].namespace);
  assert.deepEqual(Object.keys(namespaces), declaring);
  assert.deepEqual(Object.keys(specs), declaring);
  assert.equal(namespaces.jira?.name, sources.jira.name);
});

test("a source's namespace reads the kinds of its items from the index it is given", () => {
  const record = (key: string, kind: string): IndexRecord => ({
    id: `jira:${key}`,
    stableId: key,
    title: key,
    location: `https://example.invalid/browse/${key}`,
    updatedAt: instant(new Date(Date.UTC(2026, 9, 30))),
    facets: { kind },
    attrs: {},
  });
  const createStory = (index: IndexRecord[]) =>
    namespacesFor(index, { jira: { none: new Set(), home: "SYN" } })
      .jira?.fns({ ids: ["jira:SYN-1", "jira:SYN-2"], anchor: null })
      .find((fn) => fn.name === "createStory")?.doc ?? "";
  const epic = [record("SYN-1", "epic"), record("SYN-2", "story")];
  const stories = [record("SYN-1", "story"), record("SYN-2", "story")];
  assert.match(createStory(epic), /in one of this region's epics/);
  assert.doesNotMatch(createStory(stories), /epics/);
});

test("a kind with no connection open keeps its namespace, as it was before one opened", () => {
  const fns = (namespaces: ReturnType<typeof namespacesOf>) =>
    namespaces.jira?.fns({ ids: [], anchor: null }).map((fn) => [fn.name, fn.doc]);
  const unconnected = namespacesOf([], []);
  assert.deepEqual(
    Object.keys(unconnected),
    sourceKinds.filter((kind) => sources[kind].namespace),
  );
  // Nowhere to create a story with no epic, and no board's estimates.
  assert.deepEqual(
    fns(unconnected),
    fns(namespacesFor([], { jira: { none: new Set(), home: null } })),
  );
});

test("no connector's options use the names every connection has beside them, and a read-only switch is its readOnly option", () => {
  // The fields an options validator checks, through any refinement.
  const fields = (shape: Shape): string[] =>
    shape.kind === "object"
      ? Object.keys(shape.fields)
      : shape.kind === "refined" || shape.kind === "optional" || shape.kind === "nullable"
        ? fields(shape.inner)
        : [];
  for (const kind of sourceKinds) {
    const declared = fields(sources[kind].options.shape);
    for (const name of settingNames) assert.ok(!declared.includes(name), `${kind}: ${name}`);
    for (const field of sources[kind].optionFields ?? []) {
      assert.ok(
        declared.includes(field.name),
        `${kind} draws ${field.name}, which it doesn't check`,
      );
      // Only a connector that writes may be set read-only.
      if (field.kind === "read-only") assert.ok(sources[kind].specs, kind);
      // A mapping is drawn and changed by its connector's review step.
      if (field.kind === "mapping") assert.ok(sources[kind].review, kind);
    }
  }
});
