import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeBindings, stories } from "./fake-bindings.ts";
import { createSandbox } from "./sandbox.ts";
import { errorOf, exists, limits, type Logged, runner, slowTypes, tscPid } from "./testing.ts";

// Time is passed in: every duration comes out as 0.
const sandbox = createSandbox({ now: () => 0 });
const go = runner(sandbox);

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

test("exiting before returning is a runtime error", async () => {
  const { result } = await go(`(globalThis as any).Deno.exit(0);`);
  assert.equal(result.outcome, "threw");
  assert.equal(errorOf(result.transcript.at(-1)).phase, "runtime");
});

test("a script over the size cap never starts", async () => {
  const { result } = await go(`return "${"x".repeat(64)}";`, { maxScriptBytes: 32 });
  assert.equal(result.outcome, "limit");
  assert.equal(result.coldStartMs, null);
  assert.equal(errorOf(result.transcript.at(-1)).phase, "limit");
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
});

test("the result cap stops the run", async () => {
  const { result } = await go(`return "x".repeat(200);`, { maxResultBytes: 100 });
  assert.equal(result.outcome, "limit");
  assert.equal(errorOf(result.transcript.at(-1)).phase, "limit");
});

test("the host refuses to run as root", () => {
  assert.throws(() => createSandbox({ uid: 0 }));
  assert.doesNotThrow(() => createSandbox({ uid: 1000 }));
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
  assert.equal(exists(tscPid(logged)), false);
  assert.deepEqual(readdirSync(tmp), []);
});

const ps = (pid: number, field: "comm" | "pgid" | "stat") =>
  spawnSync("/bin/ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).stdout.trim();

test("tsc is the native compiler in the host's process group, and the host's exit kills it", async () => {
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

test("drafts share the intent cap, and a refused draft is not recorded", async () => {
  const capped = await go(
    `source.configure({ connection: "the waiting one", options: { channels: [] } });\nworkstream.add({ items: ["jira:SYN-1"] });\nreturn "asked";`,
    { maxIntents: 1 },
  );
  assert.equal(capped.result.outcome, "limit");
  assert.equal(capped.result.drafts.length, 1);
  assert.deepEqual(capped.result.intents, []);
  const refused = await go(
    `source.configure({ connection: "another", options: { channels: [] } });`,
  );
  assert.equal(refused.result.outcome, "threw");
  assert.deepEqual(refused.result.drafts, []);
});

test("the intent cap stops the run", async () => {
  const { result } = await go(
    `for (let i = 0; i < 3; i++) workstream.add({ items: ["jira:SYN-1"] });\nreturn "asked";`,
    { maxIntents: 2 },
  );
  assert.equal(result.outcome, "limit");
  assert.equal(result.intents.length, 2);
  assert.equal(errorOf(result.transcript.at(-1)).phase, "limit");
});
