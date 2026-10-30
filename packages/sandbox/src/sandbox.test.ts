import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Bindings, RunError, RunLimits, TranscriptEntry } from "@oriel/core";
import { fakeBindings, stories } from "./fake-bindings.ts";
import { createSandbox } from "./sandbox.ts";

// Time is passed in: every duration comes out as 0.
const sandbox = createSandbox({ now: () => 0 });

const limits: RunLimits = {
  wallMs: 60_000,
  maxScriptBytes: 16_384,
  maxReads: 20,
  maxMutations: 20,
  maxResultBytes: 65_536,
  maxConsoleBytes: 16_384,
};

type Logged = { message: string; fields: Record<string, unknown> | undefined };

async function go(
  script: string,
  caps: Partial<RunLimits> = {},
  bindings: Bindings = fakeBindings(),
) {
  const logged: Logged[] = [];
  const result = await sandbox.run(script, bindings, {
    limits: { ...limits, ...caps },
    signal: new AbortController().signal,
    log: (message, fields) => logged.push({ message, fields }),
  });
  return { result, logged };
}

function errorOf(entry: TranscriptEntry | undefined): RunError {
  assert.equal(entry?.kind, "error", JSON.stringify(entry));
  return entry.error;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("a script reads through the bindings and returns a value", async () => {
  const { result, logged } = await go(`
    const all = (await jira.listStories()) as { id: string; points: number | null }[];
    return all.filter((story) => story.points === null).map((story) => story.id);
  `);
  assert.equal(result.outcome, "ok");
  assert.deepEqual(result.transcript, [{ kind: "return", value: ["jira:SYN-2"] }]);
  const payloadHash = sha256(JSON.stringify(stories));
  assert.deepEqual(result.reads, [
    {
      fn: "jira.listStories",
      args: [],
      ms: 0,
      status: "answered",
      outsideRegion: false,
      payloadHash,
    },
  ]);
  const [typechecked, ...rest] = logged;
  assert.equal(typechecked?.message, "sandbox.typecheck");
  assert.equal(typeof typechecked.fields?.["tsc_pid"], "number");
  assert.deepEqual(rest, [
    {
      message: "sandbox.read",
      fields: {
        status: "answered",
        fn: "jira.listStories",
        args: [],
        ms: 0,
        outside_region: false,
        payload_hash: payloadHash,
      },
    },
    {
      message: "sandbox.run",
      fields: { outcome: "ok", wall_ms: 0, cold_start_ms: 0, reads: 1, mutations: 0 },
    },
  ]);
  assert.equal(result.wallMs, 0);
  assert.equal(result.coldStartMs, 0);
});

test("fetched content comes back as a value, and the escape hatch is marked", async () => {
  const { result, logged } = await go(`
    const story = (await jira.getStory("jira:SYN-2")) as { summary: string };
    await search("estimates");
    return story.summary;
  `);
  assert.deepEqual(result.transcript, [{ kind: "return", value: stories[1]?.summary }]);
  assert.deepEqual(
    result.reads.map((read) => [read.fn, read.args, read.outsideRegion]),
    [
      ["jira.getStory", ["jira:SYN-2"], false],
      ["search", ["estimates"], true],
    ],
  );
  assert.ok(!JSON.stringify(logged).includes("Ignore all previous"), "a payload reached the log");
});

test("writes are captured in order, a create names its item, and none is answered", async () => {
  const { result } = await go(`
    const ref = jira.createStory({ summary: "Split the import" });
    jira.setEstimate(ref, 2);
    jira.setEstimate("jira:SYN-2", 3);
    return ref;
  `);
  assert.equal(result.outcome, "ok");
  assert.deepEqual(result.mutations, [
    { op: "jira.createStory", target: null, ref: "new:1", args: [{ summary: "Split the import" }] },
    { op: "jira.setEstimate", target: "new:1", ref: null, args: ["new:1", 2] },
    { op: "jira.setEstimate", target: "jira:SYN-2", ref: null, args: ["jira:SYN-2", 3] },
  ]);
  assert.deepEqual(result.transcript, [{ kind: "return", value: "new:1" }]);
  assert.deepEqual(result.reads, []);
});

test("console output becomes log lines in the transcript", async () => {
  const { result } = await go(`
    console.log("counted", { stories: 3 });
    console.error("and warned");
    return 1;
  `);
  assert.deepEqual(result.transcript, [
    { kind: "log", text: 'counted {"stories":3}' },
    { kind: "log", text: "and warned" },
    { kind: "return", value: 1 },
  ]);
});

test("concurrent reads are answered out of order and recorded in request order", async () => {
  const { result } = await go(`return await Promise.all([jira.second(), jira.first()]);`);
  assert.deepEqual(result.transcript, [{ kind: "return", value: ["second", "first"] }]);
  assert.deepEqual(
    result.reads.map((read) => read.fn),
    ["jira.second", "jira.first"],
  );
});

test("a read the bindings reject throws inside the guest", async () => {
  const { result, logged } = await go(`
    try {
      await jira.fail();
      return "read";
    } catch (error) {
      return (error as Error).message;
    }
  `);
  assert.deepEqual(result.transcript, [{ kind: "return", value: "the source is down" }]);
  assert.deepEqual(result.reads, [
    {
      fn: "jira.fail",
      args: [],
      ms: 0,
      status: "failed",
      outsideRegion: null,
      payloadHash: null,
    },
  ]);
  assert.deepEqual(
    logged.filter((line) => line.message === "sandbox.read"),
    [
      {
        message: "sandbox.read",
        fields: { status: "failed", fn: "jira.fail", args: [], ms: 0, error: "the source is down" },
      },
    ],
  );
});

test("nothing returned is null", async () => {
  const { result } = await go(`const unused = 1;`);
  assert.deepEqual(result.transcript, [{ kind: "return", value: null }]);
});

test("an uncaught error comes back with the script's own line numbers", async () => {
  const { result } = await go(
    `console.log("before");\nconst n: number = 2;\nthrow new Error("boom " + n);`,
  );
  assert.equal(result.outcome, "threw");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "runtime");
  assert.match(error.message, /Error: boom 2/);
  assert.match(error.message, /script\.ts:3:\d+/);
  assert.doesNotMatch(error.message, /oriel-run-|entry\.ts|file:\/\//);
  assert.deepEqual(error.logs, ["before"]);
});

test("a rejection nobody awaited ends the run", async () => {
  const { result } = await go(`void jira.fail();\nawait new Promise(() => {});`);
  assert.equal(result.outcome, "threw");
  assert.match(errorOf(result.transcript.at(-1)).message, /the source is down/);
});

test("a return value that isn't JSON is an error, not a crash", async () => {
  const { result } = await go(`return 10n;`);
  assert.equal(result.outcome, "threw");
  assert.match(errorOf(result.transcript.at(-1)).message, /Do not know how to serialize a BigInt/);
});

test("a syntax error is a typecheck error, and Deno never starts", async () => {
  const { result } = await go(`const ok = 1;\nconst = 2;`);
  assert.equal(result.outcome, "threw");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "typecheck");
  assert.match(
    error.message,
    /^The script doesn't compile as the body of an async function: .*Unexpected token/,
  );
  assert.equal(result.coldStartMs, null);
});

test("TypeScript that doesn't erase is a typecheck error", async () => {
  const { result } = await go(`enum Size { S, M }\nreturn Size.M;`);
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "typecheck");
  assert.match(error.message, /enum is not supported/);
});

test("types are erased, and positions stay the script's own", async () => {
  const { result } = await go(
    `type Story = { id: string; points: number | null };\nconst all = (await jira.listStories()) as Story[];\nconst first = <T,>(items: T[]): T | undefined => items[0];\nif (all.length) throw new Error(String(first(all)?.id));`,
  );
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "runtime");
  assert.match(error.message, /^Error: jira:SYN-1\n\s+at script\.ts:4:23/);
});

test("a script that closes its function is refused before Deno starts", async () => {
  const { result } = await go(`return 1;\n});\nconsole.log("outside");\n(async () => {`);
  assert.equal(result.outcome, "threw");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "typecheck");
  assert.equal(result.coldStartMs, null);
});

test("a write the bindings refuse ends the run", async () => {
  const { result } = await go(`
    jira.setEstimate("jira:SYN-2", 1);
    jira.setEstimate("jira:SYN-99", 1);
    return "sent";
  `);
  assert.equal(result.outcome, "threw");
  assert.equal(result.mutations.length, 1);
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "runtime");
  assert.equal(error.message, "jira.setEstimate was refused: jira:SYN-99 is not in this region");
});

test("a ref can only be created once", async () => {
  // Past the typecheck the way a hostile script would: through globalThis.
  const { result } = await go(`
    const g = globalThis as any;
    const send = (message: unknown) =>
      g.Deno.stdout.writeSync(new g.TextEncoder().encode(JSON.stringify(message) + "\\n"));
    send({ kind: "write", fn: "jira.createStory", args: [{ summary: "a" }], ref: "new:1" });
    send({ kind: "write", fn: "jira.createStory", args: [{ summary: "b" }], ref: "new:1" });
    return null;
  `);
  assert.equal(result.outcome, "threw");
  assert.equal(result.mutations.length, 1);
  assert.match(errorOf(result.transcript.at(-1)).message, /new:1 was already created/);
});

test("the entry file is the shim alone, and the script reaches the guest as data", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "oriel-entry-"));
  const controller = new AbortController();
  let entry = "";
  const bindings = fakeBindings(() => {
    const [run = ""] = readdirSync(tmp);
    entry = readFileSync(join(tmp, run, "entry.ts"), "utf8");
    controller.abort(new Error("seen"));
  });
  const running = createSandbox({ now: () => 0, tmpDir: tmp }).run(
    `const marker = "script-marker-93f1";\nawait jira.hold();`,
    bindings,
    { limits, signal: controller.signal, log: () => {} },
  );
  await assert.rejects(running, /seen/);
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(entry, bindings.shim);
  assert.ok(!entry.includes("script-marker-93f1"));
});

test("a guest that ends without done or threw is a runtime error", async () => {
  // The guest can't even describe this error, so it never reports it.
  const { result } = await go(
    `const error = new Error("hidden");\nObject.defineProperty(error, "stack", { get() { throw new Error("no stack"); } });\nthrow error;`,
  );
  assert.equal(result.outcome, "threw");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "runtime");
  assert.match(error.message, /stopped before returning \(exit code 1\)/);
});

test("exiting before returning is a runtime error", async () => {
  const { result } = await go(`(globalThis as any).Deno.exit(0);`);
  assert.equal(result.outcome, "threw");
  assert.match(
    errorOf(result.transcript.at(-1)).message,
    /stopped before returning \(exit code 0\)/,
  );
});

test("a script over the size cap never starts", async () => {
  const { result } = await go(`return "${"x".repeat(64)}";`, { maxScriptBytes: 32 });
  assert.equal(result.outcome, "limit");
  assert.equal(result.coldStartMs, null);
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "limit");
  assert.match(error.message, /the limit is 32/);
});

test("the read cap stops the run", async () => {
  const { result } = await go(
    `for (let i = 0; i < 3; i++) await jira.listStories();\nreturn "read";`,
    {
      maxReads: 2,
    },
  );
  assert.equal(result.outcome, "limit");
  assert.equal(result.reads.length, 2);
  assert.match(errorOf(result.transcript.at(-1)).message, /more than 2 reads/);
});

test("the mutation cap stops the run", async () => {
  const { result } = await go(
    `for (let i = 0; i < 3; i++) jira.setEstimate("jira:SYN-1", i);\nreturn "sent";`,
    {
      maxMutations: 2,
    },
  );
  assert.equal(result.outcome, "limit");
  assert.equal(result.mutations.length, 2);
  assert.match(errorOf(result.transcript.at(-1)).message, /more than 2 mutations/);
});

test("the result cap stops the run", async () => {
  const { result } = await go(`return "x".repeat(200);`, { maxResultBytes: 100 });
  assert.equal(result.outcome, "limit");
  assert.match(
    errorOf(result.transcript.at(-1)).message,
    /return value is 202 bytes; the limit is 100/,
  );
});

test("the wall-time kill comes back as a clean limit error that names the cap", async () => {
  const { result } = await go(`for (;;) {}`, { wallMs: 1_000 });
  assert.equal(result.outcome, "timeout");
  assert.deepEqual(result.transcript, [
    {
      kind: "error",
      error: {
        phase: "limit",
        message: "the run passed its wall time of 1000 ms and was stopped",
        hint: "Look for a loop that never ends or a promise that never settles, and do less per run.",
        logs: [],
      },
    },
  ]);
});

test("the host refuses to run as root", () => {
  assert.throws(() => createSandbox({ uid: 0 }), /refuses to run as root/);
  assert.doesNotThrow(() => createSandbox({ uid: 1000 }));
});

test("the console cap stops the run and keeps the lines before it", async () => {
  const { result } = await go(`console.log("12345");\nconsole.log("123456");\nreturn 1;`, {
    maxConsoleBytes: 10,
  });
  assert.equal(result.outcome, "limit");
  assert.deepEqual(result.transcript.slice(0, -1), [{ kind: "log", text: "12345" }]);
  const error = errorOf(result.transcript.at(-1));
  assert.match(error.message, /console output passed 10 bytes/);
  assert.deepEqual(error.logs, ["12345"]);
});

test("aborting stops the run and rejects with the reason", async () => {
  const controller = new AbortController();
  const reason = new Error("the user stopped the thread");
  const running = sandbox.run(
    `await jira.hold();`,
    fakeBindings(() => controller.abort(reason)),
    {
      limits,
      signal: controller.signal,
      log: () => {},
    },
  );
  await assert.rejects(running, reason);
});

test("the outcome follows the error's phase", async () => {
  // A type error is the script's to fix.
  const typed = await go(`const n: number = "two";\nreturn n;`);
  assert.equal(errorOf(typed.result.transcript.at(-1)).phase, "typecheck");
  assert.equal(typed.result.outcome, "threw");
  // The bindings' own size cap is a limit, not a throw.
  const big = await go(`return "${"x".repeat(70_000)}";`, { maxScriptBytes: 100_000 });
  assert.equal(errorOf(big.result.transcript.at(-1)).phase, "limit");
  assert.equal(big.result.outcome, "limit");
});

test("reads still out when a run ends are logged as unanswered, and a late answer is ignored", async () => {
  const base = fakeBindings();
  let answer = () => {};
  const bindings: Bindings = {
    ...base,
    read: (fn, args) =>
      fn === "jira.hold"
        ? new Promise(
            (resolve) => (answer = () => resolve({ value: "late", outsideRegion: false })),
          )
        : base.read(fn, args),
  };
  const { result, logged } = await go(
    `await jira.listStories();\nawait jira.hold();`,
    { wallMs: 1_000 },
    bindings,
  );
  assert.equal(result.outcome, "timeout");
  const lines = () =>
    logged
      .filter((line) => line.message !== "sandbox.typecheck")
      .map((line) => [line.message, line.fields?.["status"] ?? line.fields?.["outcome"]]);
  const expected = [
    ["sandbox.read", "answered"],
    ["sandbox.read", "unanswered"],
    ["sandbox.run", "timeout"],
  ];
  assert.deepEqual(lines(), expected);
  answer();
  // Let the late answer land, then check nothing came of it.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines(), expected);
  assert.deepEqual(
    result.reads.map((read) => [read.fn, read.status, read.payloadHash === null]),
    [
      ["jira.listStories", "answered", false],
      ["jira.hold", "unanswered", true],
    ],
  );
});

// Types that keep tsc busy for seconds: a 100,000-member union compared
// against tuples it doesn't fit.
const slowTypes = [
  "type D = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;",
  "type Flat<T extends unknown[]> = T extends [infer H, ...infer R] ? (H extends unknown ? [H, ...Flat<R>] : never) : [];",
  "const all = null as unknown as Flat<[D, D, D, D, D]>;",
  "const a: [number, number, number, number, string] = all;",
  "const b: [string, number, number, number, number] = all;",
  "const c: [number, string, number, number, number] = all;",
  "return [a, b, c];",
].join("\n");

// Whether a process is still there, zombies included.
const exists = (pid: number) =>
  spawnSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim() !==
  "";

function tscPid(logged: Logged[]): number {
  const pid = logged.find((line) => line.message === "sandbox.typecheck")?.fields?.["tsc_pid"];
  assert.equal(typeof pid, "number");
  return Number(pid);
}

test("types that keep tsc busy end at the deadline, with no tsc or temp directory left", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "oriel-tsc-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  // A high memory cap, so the deadline is what stops tsc here.
  const box = createSandbox({ now: () => 0, tmpDir: tmp, maxRssMb: 4096 });
  const logged: Logged[] = [];
  const log = (message: string, fields?: Record<string, unknown>) =>
    logged.push({ message, fields });
  const signal = new AbortController().signal;
  const result = await box.run(slowTypes, fakeBindings(), {
    limits: { ...limits, wallMs: 2_000 },
    signal,
    log,
  });
  assert.equal(result.outcome, "timeout");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "limit");
  assert.match(error.message, /typecheck took longer than|while its types were checked/);
  assert.equal(exists(tscPid(logged)), false);
  assert.deepEqual(readdirSync(tmp), []);
  const next = await box.run(`return 1;`, fakeBindings(), { limits, signal, log: () => {} });
  assert.deepEqual(next.transcript, [{ kind: "return", value: 1 }]);
});

test("tsc over the memory cap is killed from the host", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "oriel-tsc-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const box = createSandbox({ now: () => 0, tmpDir: tmp, maxRssMb: 256, memoryPollMs: 10 });
  const logged: Logged[] = [];
  const result = await box.run(slowTypes, fakeBindings(), {
    limits,
    signal: new AbortController().signal,
    log: (message, fields) => logged.push({ message, fields }),
  });
  assert.equal(result.outcome, "limit");
  assert.match(errorOf(result.transcript.at(-1)).message, /the typecheck used \d+ MB of memory/);
  assert.equal(exists(tscPid(logged)), false);
  assert.deepEqual(readdirSync(tmp), []);
});

// One field of `ps` for a process, or "" once it's gone.
const ps = (pid: number, field: "comm" | "pgid" | "stat") =>
  spawnSync("/bin/ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).stdout.trim();

test("tsc is the native compiler in the host's process group, and the host's exit kills it", async () => {
  // A child Node process is the host: it prints tsc's pid as tsc starts, and
  // exits mid-compile when told to.
  const host = `
    import { createSandbox } from ${JSON.stringify(new URL("./sandbox.ts", import.meta.url).href)};
    import { fakeBindings } from ${JSON.stringify(new URL("./fake-bindings.ts", import.meta.url).href)};
    process.stdin.once("data", () => process.exit(0));
    void createSandbox({ maxRssMb: 4096 }).run(${JSON.stringify(slowTypes)}, fakeBindings(), {
      limits: ${JSON.stringify(limits)},
      signal: new AbortController().signal,
      log: (message, fields) => {
        if (message === "sandbox.typecheck") process.stdout.write(fields.tsc_pid + "\\n");
      },
    });
  `;
  const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", host], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const closed = new Promise((resolve) => child.on("close", resolve));
  child.stdout.setEncoding("utf8");
  const pid = await new Promise<number>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("\n")) resolve(Number(out.trim()));
    });
    child.once("close", () => reject(new Error("the host exited before tsc started")));
  });
  // The compiler itself, not a Node launcher, and not a group leader: it is
  // in the host's group, where a Ctrl-C or hangup reaches it.
  assert.match(ps(pid, "comm"), /(^|\/)tsc$/);
  assert.notEqual(Number(ps(pid, "pgid")), pid);
  assert.equal(ps(pid, "pgid"), ps(child.pid ?? 0, "pgid"));
  child.stdin.end("exit\n");
  await closed;
  const stat = ps(pid, "stat");
  assert.ok(stat === "" || stat.startsWith("Z"), `tsc outlived its host: ${stat}`);
});

test("an abort while tsc runs kills it from the host", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "oriel-tsc-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const box = createSandbox({ now: () => 0, tmpDir: tmp });
  const controller = new AbortController();
  const logged: Logged[] = [];
  const running = box.run(slowTypes, fakeBindings(), {
    limits,
    signal: controller.signal,
    log: (message, fields) => {
      logged.push({ message, fields });
      if (message === "sandbox.typecheck") controller.abort(new Error("stopped"));
    },
  });
  await assert.rejects(running, /stopped/);
  // The next run waits in the queue until the aborted one is cleaned up.
  const signal = new AbortController().signal;
  const next = await box.run(`return 1;`, fakeBindings(), { limits, signal, log: () => {} });
  assert.deepEqual(next.transcript, [{ kind: "return", value: 1 }]);
  assert.equal(exists(tscPid(logged)), false);
  assert.deepEqual(readdirSync(tmp), []);
});

test("an abort while queued behind a slow compile rejects at once and starts no tsc", async () => {
  const box = createSandbox({ now: () => 0, maxRssMb: 4096 });
  const slow = box.run(slowTypes, fakeBindings(), {
    limits: { ...limits, wallMs: 3_000 },
    signal: new AbortController().signal,
    log: () => {},
  });
  const controller = new AbortController();
  const queuedLog: string[] = [];
  const queued = box.run(`return 1;`, fakeBindings(), {
    limits,
    signal: controller.signal,
    log: (message) => queuedLog.push(message),
  });
  controller.abort(new Error("not needed"));
  const first = await Promise.race([
    queued.then(
      () => "queued resolved",
      () => "queued rejected",
    ),
    slow.then(() => "slow settled"),
  ]);
  assert.equal(first, "queued rejected");
  await assert.rejects(queued, /not needed/);
  assert.equal((await slow).outcome, "timeout");
  assert.deepEqual(queuedLog, []);
});

test("an aborted signal rejects before Deno starts", async () => {
  const reason = new Error("already stopped");
  await assert.rejects(
    sandbox.run(`return 1;`, fakeBindings(), {
      limits,
      signal: AbortSignal.abort(reason),
      log: () => {},
    }),
    reason,
  );
});
