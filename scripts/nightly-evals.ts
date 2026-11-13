//   node scripts/nightly-evals.ts --env /Users/Vibdev/code/oriel/.env
//
// Run it in a fresh checkout of origin/main, never the main checkout or a
// builder's worktree. `--env` names the .env holding ANTHROPIC_API_KEY; only
// that key is read, as `pnpm evals --env` reads it. Exit 0 when the replay
// passes, 1 when it doesn't.
//
// The T3 scheduled task's prompt, which the hub pastes into schedule_task
// (daily, 02:30):
//
//   Record Oriel's eval cassettes on main. Work only in
//   /Users/Vibdev/.t3/worktrees/oriel/nightly-evals; never touch
//   /Users/Vibdev/code/oriel except to run its scripts/github.ts, and never
//   print, copy or link its .env.
//   1. If the directory is missing: `git -C /Users/Vibdev/code/oriel worktree
//      add --detach /Users/Vibdev/.t3/worktrees/oriel/nightly-evals`. Then in
//      it: `git fetch --no-prune origin main` (if it hangs, use the port-443
//      URL in rules2.md), `git checkout --detach origin/main`,
//      `git clean -fdx -e .evals`, `pnpm install --frozen-lockfile`.
//   2. `~/.claude-hub/bin/heavy node scripts/nightly-evals.ts --env
//      /Users/Vibdev/code/oriel/.env > /tmp/oriel-nightly.md`. If a POST fails
//      on a connect timeout, run it once more with
//      NODE_OPTIONS=--network-family-autoselection-attempt-timeout=3000.
//   3. If `git status --porcelain` lists nothing, stop and report "no change".
//      Otherwise `git switch -C evals-night`, `git add -A tests/cassettes
//      packages/evals`, and commit "test(evals): the night's recording,
//      <date>" with the attribution lines. Push with
//      `git push --force origin HEAD:evals-night`.
//   4. Open the PR from the main checkout: `node
//      /Users/Vibdev/code/oriel/scripts/github.ts pr-create evals-night
//      "test(evals): the night's recording, <date>" "<the summary file's
//      text>"`. If one is open already on evals-night, pr-edit it instead.
//   5. If the script exited 0 and the summary's "Newly failing" says none,
//      `pr-wait` it, then `pr-enqueue` it once CI passes. Otherwise leave it
//      for the hub, and say why in one line.
//   6. Report: the PR, the pass rates line, newly failing cases, spend.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { repoIo } from "../packages/evals/src/cli.ts";
import { recordNight } from "../packages/evals/src/nightly.ts";
import { nightlyFile, staleFile } from "../packages/evals/src/repo.ts";

async function run(): Promise<number> {
  const { values } = parseArgs({ options: { env: { type: "string" } }, strict: true });
  if (!values.env) {
    console.error("usage: node scripts/nightly-evals.ts --env <path to the main checkout's .env>");
    return 1;
  }
  const { code, text } = await recordNight({
    ...repoIo,
    // Rounds log to stderr: a grade's detail can quote the model, which reads
    // planted injections, so stdout carries only the summary the PR pastes.
    log: console.error,
    stale: staleFile,
    nightly: nightlyFile,
    env: values.env,
    date: new Date().toISOString().slice(0, 10),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  });
  console.log(text);
  return code;
}

if (import.meta.main) process.exitCode = await run();
