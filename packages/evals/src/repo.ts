// From the repo root, whatever the working directory: `pnpm evals` runs from the root,
// `evals:ci` from this package.
export const repoRoot = new URL("../../../", import.meta.url);
export const casesDir = new URL("packages/evals/cases/", repoRoot);
export const cassettesDir = new URL("tests/cassettes/", repoRoot);
export const roundsDir = new URL(".evals/", repoRoot);
export const climbsDir = new URL("packages/evals/climbs/", repoRoot);
export const envFile = new URL(".env", repoRoot);
export const staleFile = new URL("packages/evals/stale.md", repoRoot);
export const nightlyFile = new URL("packages/evals/nightly.json", repoRoot);
