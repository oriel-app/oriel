import assert from "node:assert/strict";
import { test } from "node:test";
import { allowlist, lockedPackages, problems } from "./check-repo.ts";

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
