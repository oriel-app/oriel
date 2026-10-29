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

const adr = "Adds `oxlint` and `@oxlint/*`.";

test("lockedPackages reads names from the packages section only", () => {
  assert.deepEqual(lockedPackages(lockfile), ["@oxlint/binding-darwin-arm64", "oxlint"]);
});

test("allowlist reads backticked entries under Dependencies only", () => {
  assert.deepEqual(allowlist(agentsMd), ["oxlint", "@oxlint/*"]);
});

test("a clean repo has no problems", () => {
  assert.deepEqual(problems({ claudeLink: "AGENTS.md", lockfile, agentsMd, decisions: [adr] }), []);
});

test("a package missing from the allowlist is reported", () => {
  const found = problems({
    claudeLink: "AGENTS.md",
    lockfile,
    agentsMd: "## Dependencies\n`oxlint`\n",
    decisions: [adr],
  });
  assert.deepEqual(found, [
    "@oxlint/binding-darwin-arm64: not on the AGENTS.md dependency allowlist",
  ]);
});

test("an allowlisted package with no ADR is reported once per entry", () => {
  const found = problems({
    claudeLink: "AGENTS.md",
    lockfile,
    agentsMd,
    decisions: ["Adds `oxlint`."],
  });
  assert.deepEqual(found, ["@oxlint/*: no ADR in docs/decisions/ names it"]);
});

test("CLAUDE.md must link to exactly AGENTS.md", () => {
  const found = problems({ claudeLink: "AGENTS.md\n", lockfile, agentsMd, decisions: [adr] });
  assert.equal(found.length, 1);
  assert.match(found[0] ?? "", /CLAUDE\.md must be a symlink/);
});
