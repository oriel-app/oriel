// `pnpm ui-test`: the window's behaviour tests (decision 0063). Each is a
// scene of `pnpm shots` that checks behaviour, run light at 1280 (and at the
// other widths it names), with no picture; and the first run's timed
// onboarding on each path. They run in workers, each a `scripts/shots.ts
// --test` of its own, with its own servers, taking every nth test.
// `pnpm ui-test ask-panel-` takes only the tests whose names start so, and
// `--workers <n>` sets how many run at once.
import { fork } from "node:child_process";
import { availableParallelism } from "node:os";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const asked = parseArgs({
  options: { workers: { type: "string" } },
  allowPositionals: true,
});
const workers = Number(
  asked.values.workers ?? Math.max(1, Math.min(4, availableParallelism() - 1)),
);
if (!Number.isInteger(workers) || workers < 1) throw new Error(`Not a count: ${workers}`);

const began = Date.now();
let passed = 0;
const failed: string[] = [];
const exits = Array.from({ length: workers }, (_, at) => {
  const worker = fork(
    new URL("shots.ts", import.meta.url),
    ["--test", "--lane", `${at + 1}/${workers}`, ...asked.positionals],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  for (const [from, to] of [
    [worker.stdout, process.stdout],
    [worker.stderr, process.stderr],
  ] as const) {
    if (!from) continue;
    createInterface({ input: from }).on("line", (line) => {
      if (line.startsWith("ok ")) passed++;
      if (line.startsWith("FAIL ")) failed.push(line);
      to.write(`${line}\n`);
    });
  }
  return new Promise<number>((done) => worker.on("exit", (code) => done(code ?? 1)));
});
const codes = await Promise.all(exits);
const seconds = Math.round((Date.now() - began) / 1000);
console.log(`\n${passed} passed, ${failed.length} failed, in ${seconds}s on ${workers} workers`);
for (const line of failed) console.log(line);
process.exitCode = codes.every((code) => code === 0) ? 0 : 1;
