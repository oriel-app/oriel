import assert from "node:assert/strict";
import { test } from "node:test";
import { actionProblems, chromeLaunchProblems, exemptRoutes, problems } from "./check-repo.ts";

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

type Repo = Partial<typeof clean> & { sources?: { path: string; text: string }[] };

const flagged = (repo: Repo) => [
  ...new Set(problems({ ...clean, ...repo }).map((p) => p.slice(0, p.indexOf(": ")))),
];

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
  assert.deepEqual(flagged({ sources: [...clean.sources, ...sneaky] }), [
    "packages/thread/src/loop.ts",
    "packages/bindings/src/x.ts",
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
    { path: "packages/server/src/y.test.ts", text: 'import { w } from "@oriel/jira/writer";' },
  ];
  assert.deepEqual(flagged({ sources }), [
    "packages/changeset/src/apply.ts",
    "packages/sandbox/src/host.ts",
    "packages/server/src/x.ts",
    "packages/jira/src/source.ts",
    "scripts/x.ts",
    "packages/server/src/y.test.ts",
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
  assert.deepEqual(flagged({ sources }), ["packages/server/src/x.ts"]);
});

test("a template literal in import() names a module like a quoted string does", () => {
  const sources = [
    { path: "packages/server/src/x.ts", text: "const w = await import(`@oriel/jira/writer`);" },
    { path: "packages/server/src/w.ts", text: "await import(`@oriel/${kind}/writer`);" },
    { path: "packages/jira/src/v.ts", text: "// The writer is `@oriel/jira/writer` only." },
  ];
  assert.deepEqual(flagged({ sources }), ["packages/server/src/x.ts"]);
});

test("only an adapter's own writer.ts is exempt, not any package's", () => {
  const sources = [
    { path: "packages/groupings/src/writer.ts", text: 'import { w } from "@oriel/jira/writer";' },
    { path: "packages/groupings/src/writer.test.ts", text: "w: SourceWriter<K>" },
    { path: "packages/jira/src/writer.ts", text: 'SourceWriter<"jira">' },
    { path: "packages/jira/src/writer.test.ts", text: 'import { jiraWriter } from "./writer.ts";' },
  ];
  assert.deepEqual(flagged({ sources }), [
    "packages/groupings/src/writer.ts",
    "packages/groupings/src/writer.test.ts",
  ]);
});

test("a package missing from the allowlist is reported", () => {
  assert.deepEqual(flagged({ agentsMd: "## Dependencies\n`oxlint`\n" }), [
    "@oxlint/binding-darwin-arm64",
  ]);
});

test("a package from a git or tarball URL is reported", () => {
  const evil = lockfile.replace(
    "oxlint@1.89.0:",
    "oxlint@https://codeload.github.com/evil/oxlint/tar.gz/abc:",
  );
  assert.deepEqual(flagged({ lockfile: evil }), [
    "oxlint@https://codeload.github.com/evil/oxlint/tar.gz/abc",
  ]);
});

test("a lockfile that declares dependencies but parses to nothing is reported", () => {
  const unreadable = lockfile.replace("packages:", "pkgs:");
  assert.deepEqual(flagged({ lockfile: unreadable }), ["pnpm-lock.yaml"]);
});

const route = (path: string, code: string) =>
  `{ method: "POST", path: at("${path}"), async run() { ${code} } },`;
const routes = (extra: string) => ({
  path: "packages/server/src/api.ts",
  text: [...Object.keys(exemptRoutes).map((path) => route(path, "work();")), extra].join("\n"),
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
  assert.deepEqual(flagged({ sources: [...clean.sources, routes(moved)] }), []);
  const sneaky = `{
    method: "POST",
    path: at("/workstreams/:id/rename"),
    async run([id = ""]) { workstreams.rename(id, "x"); },
  },`;
  assert.deepEqual(flagged({ sources: [...clean.sources, routes(sneaky)] }), [
    "packages/server/src/api.ts",
  ]);
  const test = { path: "packages/server/src/testing.ts", text: sneaky };
  assert.deepEqual(flagged({ sources: [...clean.sources, routes(""), test] }), []);
});

test("a draftable action is direct and closed to the agent: never open to it, never a person's", () => {
  const input = Object.assign(() => ({ ok: true as const, value: {} }), {
    shape: { kind: "unknown" as const },
  });
  const found = actionProblems({
    "source.configure": {
      doc: "Sets.",
      input,
      class: { kind: "direct", inverse: "source.configure" },
      closed: { agent: "The user's (decision 0051)." },
      draftable: true,
    },
    "workstream.add": {
      doc: "Adds.",
      input,
      class: { kind: "direct", inverse: "workstream.add" },
      draftable: true,
    },
    "source.connect": {
      doc: "Connects.",
      input,
      class: { kind: "person-only", why: "It holds credentials." },
      draftable: true,
    },
  });
  assert.equal(found.length, 2);
  assert.ok(found[0]?.includes("workstream.add"));
  assert.ok(found[1]?.includes("source.connect"));
});

test("a Chrome launch must be the installed Chrome with its sandbox on, and nothing passes --no-sandbox", () => {
  const ok = `const browser = await chromium.launch({
  channel: "chrome",
  chromiumSandbox: true,
  args: [\`--log-net-log=\${join(out, "x")}\`],
});`;
  assert.deepEqual(chromeLaunchProblems("scripts/ok.ts", ok), []);
  assert.equal(
    chromeLaunchProblems("scripts/a.ts", `await chromium.launch({ chromiumSandbox: true });`)
      .length,
    1,
  );
  assert.equal(
    chromeLaunchProblems(
      "scripts/b.ts",
      `await chromium.launchPersistentContext(dir, { channel: "chrome" });`,
    ).length,
    1,
  );
  assert.equal(
    chromeLaunchProblems(
      "scripts/c.ts",
      `await chromium.launch(); const o = { channel: "chrome", chromiumSandbox: true };`,
    ).length,
    2,
  );
  assert.equal(
    chromeLaunchProblems("scripts/d.ts", `spawn(chrome, ["--headless", "--no-sandbox"]);`).length,
    1,
  );
  assert.deepEqual(flagged({ sources: [{ path: "scripts/e.ts", text: "chromium.launch({})" }] }), [
    "scripts/e.ts",
  ]);
});
