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

test("importing an adapter's writer outside changeset is reported", () => {
  const sources = [
    {
      path: "packages/changeset/src/apply.ts",
      text: 'import { writer } from "@oriel/jira/writer";',
    },
    { path: "packages/sandbox/src/host.ts", text: "import { writer } from '@oriel/jira/writer';" },
  ];
  assert.deepEqual(problems({ ...clean, sources }), [
    "packages/sandbox/src/host.ts: imports a source writer outside packages/changeset (decision 0003)",
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
