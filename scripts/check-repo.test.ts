import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionProblems,
  allowlist,
  exemptRoutes,
  lockedPackages,
  postRoutes,
  problems,
} from "./check-repo.ts";

const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      oxlint:
        specifier: 1.89.0
        version: 1.89.0

packages:

  '@oxlint/binding-darwin-arm64@1.89.0':
    resolution: {integrity: sha512-x}

  oxlint@1.89.0:
    resolution: {integrity: sha512-y}

snapshots:

  not-a-package@1.0.0: {}
`;

const agentsMd = `# Oriel

Use \`pnpm check\`.

## Dependencies

\`oxlint\` \`@oxlint/*\`

## Next
\`ignored\`
`;

const adr = "# 0009 Toolchain\n\nAdds: `oxlint` `@oxlint/*`\n";
const clean = {
  claudeLink: "AGENTS.md",
  lockfile,
  agentsMd,
  decisions: [adr],
  sources: [
    { path: "packages/changeset/src/approve.ts", text: "return cs as Approved<ChangeSet>;" },
  ],
};

test("naming Approved outside core and changeset is reported, aliases included", () => {
  const sneaky = [
    {
      path: "packages/thread/src/loop.ts",
      text: "w.apply(m as unknown as Approved<WriteRequest>)",
    },
    {
      path: "packages/bindings/src/x.ts",
      text: 'import { type Approved as Ok } from "@oriel/core";',
    },
    { path: "packages/core/src/changeset.ts", text: "export type Approved<T> = Readonly<T>;" },
  ];
  assert.deepEqual(problems({ ...clean, sources: [...clean.sources, ...sneaky] }), [
    "packages/thread/src/loop.ts: names Approved outside packages/core and packages/changeset (decision 0003)",
    "packages/bindings/src/x.ts: names Approved outside packages/core and packages/changeset (decision 0003)",
  ]);
});

test("importing an adapter's writer anywhere but the file that builds writers is reported, by any path", () => {
  const sources = [
    {
      path: "packages/changeset/src/writers.ts",
      text: 'import { jiraWriter } from "@oriel/jira/writer";',
    },
    {
      path: "packages/changeset/src/apply.ts",
      text: 'import { writer } from "@oriel/jira/writer";',
    },
    { path: "packages/jira/src/writer.test.ts", text: 'import { jiraWriter } from "./writer.ts";' },
    { path: "packages/sandbox/src/host.ts", text: "import { writer } from '@oriel/jira/writer';" },
    { path: "packages/server/src/x.ts", text: 'import { w } from "../../jira/src/writer.ts";' },
    { path: "packages/jira/src/source.ts", text: 'const w = await import("./writer.ts");' },
    { path: "scripts/x.ts", text: 'import { w } from "../packages/jira/src/writer";' },
  ];
  const where = "imports a source writer outside packages/changeset/src/writers.ts (decision 0003)";
  // The adapter rule refuses each one in packages/ too.
  const also =
    "imports the jira writer; only packages/changeset/src/writers.ts builds writers (decisions 0003 and 0019)";
  assert.deepEqual(problems({ ...clean, sources }), [
    `packages/changeset/src/apply.ts: ${where}`,
    `packages/changeset/src/apply.ts: ${also}`,
    `packages/sandbox/src/host.ts: ${where}`,
    `packages/sandbox/src/host.ts: ${also}`,
    `packages/server/src/x.ts: ${where}`,
    `packages/server/src/x.ts: ${also}`,
    "packages/server/src/x.ts: imports packages/jira by a relative path; packages reach each other only through @oriel/jira and its exports",
    `packages/jira/src/source.ts: ${where}`,
    `packages/jira/src/source.ts: ${also}`,
    `scripts/x.ts: ${where}`,
  ]);
});

test("naming SourceWriter, which can stand in for an approval in a cast, is reported", () => {
  const sources = [
    { path: "packages/core/src/source.ts", text: "export interface SourceWriter<K> {}" },
    { path: "packages/changeset/src/apply.ts", text: "w: SourceWriter<K>" },
    { path: "packages/jira/src/writer.ts", text: 'SourceWriter<"jira">' },
    {
      path: "packages/jira/src/writer.test.ts",
      text: 'm as Parameters<SourceWriter<"jira">["apply"]>[0]',
    },
    { path: "packages/server/src/x.ts", text: 'm as Parameters<SourceWriter<"jira">["apply"]>[0]' },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/server/src/x.ts: names SourceWriter outside packages/core, packages/changeset and an adapter's writer (decision 0003)",
  ]);
});

test("importing a source adapter outside its package, the server, evals and tests is reported", () => {
  const sources = [
    { path: "packages/groupings/src/x.ts", text: 'import { jiraAttrsOf } from "@oriel/jira";' },
    { path: "packages/changeset/src/x.ts", text: "import { jiraSpecs } from '@oriel/jira';" },
    { path: "packages/bindings/src/x.ts", text: 'const j = await import("@oriel/folder/walk");' },
    { path: "packages/sandbox/src/x.ts", text: 'import { a } from "../../jira/src/attrs.ts";' },
    // Allowed: the adapter itself, the composition root, evals and tests.
    { path: "packages/jira/src/source.ts", text: 'import { jiraAttrs } from "./attrs.ts";' },
    {
      path: "packages/server/src/window.ts",
      text: 'import { jiraPresentation } from "@oriel/jira";',
    },
    { path: "packages/evals/src/repo.ts", text: 'import { parseJiraFixture } from "@oriel/jira";' },
    {
      path: "packages/groupings/src/x.test.ts",
      text: 'import { fixtureSnapshot } from "@oriel/jira";',
    },
    {
      path: "packages/bindings/src/testing.ts",
      text: 'import { jiraNamespace } from "@oriel/jira";',
    },
    // Not adapters: core and other packages, and a name that only starts like one.
    { path: "packages/groupings/src/y.ts", text: 'import { facets } from "@oriel/core";' },
    { path: "packages/groupings/src/z.ts", text: 'import { x } from "@oriel/jiraish";' },
  ];
  const where = (kind: string) =>
    `imports the ${kind} adapter; outside packages/${kind}, packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)`;
  assert.deepEqual(problems({ ...clean, sources }), [
    `packages/groupings/src/x.ts: ${where("jira")}`,
    `packages/changeset/src/x.ts: ${where("jira")}`,
    `packages/bindings/src/x.ts: ${where("folder")}`,
    `packages/sandbox/src/x.ts: ${where("jira")}`,
    "packages/sandbox/src/x.ts: imports packages/jira by a relative path; packages reach each other only through @oriel/jira and its exports",
  ]);
});

test("the list of sources imports every adapter; a package named like it doesn't", () => {
  const sources = [
    {
      path: "packages/sources/src/index.ts",
      text: 'import { jiraDeclaration } from "@oriel/jira";',
    },
    { path: "packages/sources/src/x.ts", text: 'import { slackDeclaration } from "@oriel/slack";' },
    {
      path: "packages/sourcesish/src/x.ts",
      text: 'import { folderDeclaration } from "@oriel/folder";',
    },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/sourcesish/src/x.ts: imports the folder adapter; outside packages/folder, packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)",
  ]);
});

test("the list of sources is imported only where its adapters may be", () => {
  const sources = [
    { path: "packages/changeset/src/x.ts", text: 'import { specs } from "@oriel/sources";' },
    { path: "packages/web/src/y.ts", text: 'const s = await import("@oriel/sources");' },
    // Allowed: the composition root, evals and tests.
    { path: "packages/server/src/window.ts", text: 'import { sources } from "@oriel/sources";' },
    { path: "packages/evals/src/world.ts", text: 'import { itemDocs } from "@oriel/sources";' },
    { path: "packages/groupings/src/x.test.ts", text: 'import { sources } from "@oriel/sources";' },
    // Not the list: a package whose name only starts like it.
    { path: "packages/groupings/src/z.ts", text: 'import { x } from "@oriel/sourcesish";' },
  ];
  const where =
    "imports @oriel/sources, which reaches every adapter; outside packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)";
  assert.deepEqual(problems({ ...clean, sources }), [
    `packages/changeset/src/x.ts: ${where}`,
    `packages/web/src/y.ts: ${where}`,
  ]);
});

test("a package reaches another only through its package name, never a relative path", () => {
  const sources = [
    {
      path: "packages/server/src/x.ts",
      text: 'import { changeSetsOver } from "../../changeset/src/change-sets.ts";',
    },
    {
      path: "packages/server/src/y.ts",
      text: 'const engine = await import("../../changeset/src/change-sets.ts");',
    },
    { path: "packages/web/src/z.ts", text: 'export type { ItemRow } from "../../groupings";' },
    // Allowed: the fixture tooling in scripts/, a file in the same package, a
    // package by name, and a string that only looks like a path.
    {
      path: "packages/jira/src/x.test.ts",
      text: 'import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";',
    },
    { path: "packages/jira/src/y.ts", text: 'import { jiraAttrs } from "../src/attrs.ts";' },
    { path: "packages/server/src/w.ts", text: 'import { changeSets } from "@oriel/changeset";' },
    { path: "packages/jira/src/v.test.ts", text: 'const linkId = "../../project/SYN";' },
  ];
  const where = (path: string, other: string) =>
    `${path}: imports packages/${other} by a relative path; packages reach each other only through @oriel/${other} and its exports`;
  assert.deepEqual(problems({ ...clean, sources }), [
    where("packages/server/src/x.ts", "changeset"),
    where("packages/server/src/y.ts", "changeset"),
    where("packages/web/src/z.ts", "groupings"),
  ]);
});

test("the composition root may import an adapter, but never its writer", () => {
  const sources = [
    { path: "packages/server/src/x.ts", text: 'import { jiraWriter } from "@oriel/jira/writer";' },
    { path: "packages/server/src/y.ts", text: 'import { jiraPresentation } from "@oriel/jira";' },
    // Nor may a test elsewhere: writers stay in packages/changeset.
    { path: "packages/server/src/y.test.ts", text: 'import { w } from "@oriel/jira/writer";' },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/server/src/x.ts: imports a source writer outside packages/changeset/src/writers.ts (decision 0003)",
    "packages/server/src/x.ts: imports the jira writer; only packages/changeset/src/writers.ts builds writers (decisions 0003 and 0019)",
    "packages/server/src/y.test.ts: imports a source writer outside packages/changeset/src/writers.ts (decision 0003)",
    "packages/server/src/y.test.ts: imports the jira writer; only packages/changeset/src/writers.ts builds writers (decisions 0003 and 0019)",
  ]);
});

test("a template literal in import() names a module like a quoted string does", () => {
  const sources = [
    { path: "packages/server/src/x.ts", text: "const w = await import(`@oriel/jira/writer`);" },
    { path: "packages/groupings/src/y.ts", text: "const j = await import( `@oriel/jira` );" },
    {
      path: "packages/server/src/z.ts",
      text: "const e = await import(`../../changeset/src/change-sets.ts`);",
    },
    // Not read: an interpolated specifier, and backticked code in a comment.
    { path: "packages/server/src/w.ts", text: "await import(`@oriel/${kind}/writer`);" },
    { path: "packages/jira/src/v.ts", text: "// The writer is `@oriel/jira/writer` only." },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/server/src/x.ts: imports a source writer outside packages/changeset/src/writers.ts (decision 0003)",
    "packages/server/src/x.ts: imports the jira writer; only packages/changeset/src/writers.ts builds writers (decisions 0003 and 0019)",
    "packages/groupings/src/y.ts: imports the jira adapter; outside packages/jira, packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)",
    "packages/server/src/z.ts: imports packages/changeset by a relative path; packages reach each other only through @oriel/changeset and its exports",
  ]);
});

test("only an adapter's own writer.ts is exempt, not any package's", () => {
  const sources = [
    { path: "packages/groupings/src/writer.ts", text: 'import { w } from "@oriel/jira/writer";' },
    { path: "packages/groupings/src/writer.test.ts", text: "w: SourceWriter<K>" },
    { path: "packages/jira/src/writer.ts", text: 'SourceWriter<"jira">' },
    { path: "packages/jira/src/writer.test.ts", text: 'import { jiraWriter } from "./writer.ts";' },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/groupings/src/writer.ts: imports a source writer outside packages/changeset/src/writers.ts (decision 0003)",
    "packages/groupings/src/writer.ts: imports the jira writer; only packages/changeset/src/writers.ts builds writers (decisions 0003 and 0019)",
    "packages/groupings/src/writer.test.ts: names SourceWriter outside packages/core, packages/changeset and an adapter's writer (decision 0003)",
  ]);
});

test("lockedPackages reads keys from the packages section only", () => {
  assert.deepEqual(lockedPackages(lockfile), [
    "@oxlint/binding-darwin-arm64@1.89.0",
    "oxlint@1.89.0",
  ]);
});

test("lockedPackages reads CRLF lockfiles and every packages block", () => {
  const second = "---\npackages:\n\n  pnpm@12.14.0:\n    resolution: {}\n";
  assert.deepEqual(lockedPackages(`${lockfile}${second}`.replaceAll("\n", "\r\n")), [
    "@oxlint/binding-darwin-arm64@1.89.0",
    "oxlint@1.89.0",
    "pnpm@12.14.0",
  ]);
});

test("allowlist reads backticked entries under Dependencies only", () => {
  assert.deepEqual(allowlist(agentsMd), ["oxlint", "@oxlint/*"]);
});

test("a clean repo has no problems", () => {
  assert.deepEqual(problems(clean), []);
});

test("a package missing from the allowlist is reported", () => {
  assert.deepEqual(problems({ ...clean, agentsMd: "## Dependencies\n`oxlint`\n" }), [
    "@oxlint/binding-darwin-arm64: not on the AGENTS.md dependency allowlist",
  ]);
});

test("only an ADR's Adds line approves a package, not a passing mention", () => {
  const mention = "Rejected: `@oxlint/*`.\n\nAdds: `oxlint`\n";
  assert.deepEqual(problems({ ...clean, decisions: [mention] }), [
    "@oxlint/*: no ADR lists it on an `Adds:` line",
  ]);
});

test("a package from a git or tarball URL is reported", () => {
  const evil = lockfile.replace(
    "oxlint@1.89.0:",
    "oxlint@https://codeload.github.com/evil/oxlint/tar.gz/abc:",
  );
  assert.deepEqual(problems({ ...clean, lockfile: evil }), [
    "oxlint@https://codeload.github.com/evil/oxlint/tar.gz/abc: not from the npm registry",
  ]);
});

test("a lockfile that declares dependencies but parses to nothing is reported", () => {
  const unreadable = lockfile.replace("packages:", "pkgs:");
  assert.deepEqual(problems({ ...clean, lockfile: unreadable }), [
    "pnpm-lock.yaml: declares dependencies but no packages could be read",
  ]);
});

test("CLAUDE.md must link to exactly AGENTS.md", () => {
  const found = problems({ ...clean, claudeLink: "AGENTS.md\n" });
  assert.equal(found.length, 1);
  assert.match(found[0] ?? "", /CLAUDE\.md must be a symlink/);
});

// A routes file declaring every exempt route as the list says, as api.ts
// does, plus `extra`.
const route = (path: string, code: string) =>
  `{ method: "POST", path: at("${path}"), async run() { ${code} } },`;
const listed = (exempt = exemptRoutes) => Object.keys(exempt).map((path) => route(path, "work();"));
const routes = (extra: string, lines = listed()) => ({
  path: "packages/server/src/api.ts",
  text: [...lines, extra].join("\n"),
});

test("a POST route that changes state without the dispatcher is reported", () => {
  const moved = `{
    method: "POST",
    path: at("/workstreams/:id/remove"),
    async run([id = ""], request) {
      const { undo } = await deps.dispatch("workstream.remove", { workstream: id }, user);
    },
  },
  { method: "GET", path: at("/workstreams/:id"), async run() { workstreams.remove(); } },
  { method: "POST", path: /^\\/api\\/actions\\/([a-z.]+)$/, async run() { dispatch(name); } },`;
  assert.deepEqual(problems({ ...clean, sources: [...clean.sources, routes(moved)] }), []);
  const sneaky = `{
    method: "POST",
    path: at("/workstreams/:id/rename"),
    async run([id = ""]) { workstreams.rename(id, "x"); },
  },`;
  assert.deepEqual(problems({ ...clean, sources: [...clean.sources, routes(sneaky)] }), [
    "packages/server/src/api.ts: POST /workstreams/:id/rename changes state without calling the dispatcher (decision 0024)",
  ]);
  // Tests may post anything.
  const test = { path: "packages/server/src/testing.ts", text: sneaky };
  assert.deepEqual(problems({ ...clean, sources: [...clean.sources, routes(""), test] }), []);
});

test("an exempt route that's gone, or calls the dispatcher now, is reported", () => {
  const [first = "", ...rest] = Object.keys(exemptRoutes);
  const gone = listed(Object.fromEntries(rest.map((path) => [path, ""])));
  assert.deepEqual(problems({ ...clean, sources: [routes("", gone)] }), [
    `scripts/check-repo.ts: lists POST ${first}, which no route declares`,
  ]);
  const moved = listed().map((line) =>
    line.includes(`at("${first}")`) ? route(first, "await deps.dispatch(x);") : line,
  );
  assert.deepEqual(problems({ ...clean, sources: [routes("", moved)] }), [
    `scripts/check-repo.ts: POST ${first} calls the dispatcher now; take it off the exempt routes`,
  ]);
});

test("postRoutes reads each POST route's path and whether it dispatches", () => {
  assert.deepEqual(
    postRoutes(`[
      { method: "POST", path: at("/a"), run: () => deps.dispatch("x") },
      { method: "GET", path: at("/b"), run: () => dispatch("y") },
      { method: "POST", path: /^\\/api\\/c$/u, run: () => change() },
    ]`),
    [
      { path: "/a", dispatches: true },
      { path: "/^\\/api\\/c$/", dispatches: false },
    ],
  );
});

test("an action closed to a door, a person's, or one with no inverse must say why", () => {
  const input = Object.assign(() => ({ ok: true as const, value: {} }), {
    shape: { kind: "unknown" as const },
  });
  assert.deepEqual(
    actionProblems({
      "workstream.add": {
        doc: "Adds.",
        input,
        class: { kind: "direct", inverse: "workstream.remove" },
      },
      "workstream.remove": {
        doc: "Removes.",
        input,
        class: { kind: "direct", inverse: "workstream.add" },
        closed: { agent: " ", tool: "outside tools wait on OA-75" },
      },
      "thread.delete": { doc: "Deletes.", input, class: { kind: "person-only", why: "" } },
      "thread.done": { doc: "Done.", input, class: { kind: "direct", inverse: null, why: "" } },
      "workstream.rename": {
        doc: "Names.",
        input,
        class: { kind: "direct", inverse: "workstream.unname" },
      },
    }),
    [
      "packages/core/src/actions.ts: workstream.remove is closed to the agent without a reason (decision 0024)",
      "packages/core/src/actions.ts: thread.delete is a person's without a reason (decision 0024)",
      "packages/core/src/actions.ts: thread.done has no inverse and doesn't say why (decision 0024)",
      "packages/core/src/actions.ts: workstream.rename's inverse workstream.unname isn't an action (decision 0024)",
    ],
  );
});

test("a route whose action is known only at run time dispatches through the untyped door", () => {
  assert.deepEqual(
    postRoutes(`[{ method: "POST", path: at("/a"), run: () => deps.dispatch.untyped(n, x) }]`),
    [{ path: "/a", dispatches: true }],
  );
});

test("input only the user gives must say why, as a closed door must", () => {
  const input = Object.assign(() => ({ ok: true as const, value: {} }), {
    shape: { kind: "unknown" as const },
  });
  assert.deepEqual(
    actionProblems({
      "thread.done": {
        doc: "Done.",
        input,
        class: { kind: "direct", inverse: null, why: "Reopening comes later." },
        userOnly: { via: "Where in the window the user closed it from.", from: " " },
      },
    }),
    [
      "packages/core/src/actions.ts: thread.done's from is the user's without a reason (decision 0024)",
    ],
  );
});
