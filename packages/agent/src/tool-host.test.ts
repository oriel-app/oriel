import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WriteStalled } from "@oriel/core";
import { ProviderError } from "./provider.ts";
import { reopening } from "./server-calls.ts";
import { HostRefused, openToolHost, type ToolHostOptions } from "./tool-host.ts";

const fakeCli = fileURLToPath(new URL("./fake-claude.ts", import.meta.url));
const grant = { name: "teams", url: "https://teams.example/mcp" };

function setup(fake: Record<string, unknown> = {}, over: Partial<ToolHostOptions> = {}) {
  const folder = mkdtempSync(join(tmpdir(), "oriel-host-test-"));
  const journal = join(folder, "journal");
  const out = Promise.withResolvers<void>();
  const options: ToolHostOptions = {
    command: process.execPath,
    args: [fakeCli],
    env: { FAKE_CLAUDE: JSON.stringify({ journal, servers: [grant], ...fake }) },
    grants: [grant],
    tools: ["echo", "hang", "slow", "crash", "fails"].map((tool) => ({ server: "teams", tool })),
    log: (message) => {
      if (message.includes("declined")) out.resolve();
    },
    startMs: 10_000,
    callMs: 10_000,
    graceMs: 300,
    ...over,
  };
  const lines = () =>
    existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter(Boolean) : [];
  const calls = () => lines().filter((line) => line.startsWith("call ") || line === "released");
  return {
    options,
    lines,
    calls,
    out: out.promise,
    done: () => rmSync(folder, { recursive: true, force: true }),
  };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const failed = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  assert.fail("expected a failure");
};

const unsent = (error: unknown) => error instanceof WriteStalled;
const mayHaveLanded = (error: unknown) =>
  error instanceof ProviderError && !(error instanceof WriteStalled);

test("calls a tool on the list for Oriel alone, and declines what the CLI asks", async () => {
  const t = setup();
  const host = await openToolHost(t.options);
  const answer = await host.call({ server: "teams", tool: "echo", args: { q: 1 } });
  assert.deepEqual(answer.content, [{ type: "text", text: '{"q":1}' }]);
  assert.deepEqual(t.calls(), ["call echo not-for-model"]);
  const slow = await host.call({ server: "teams", tool: "slow", args: {} });
  assert.deepEqual(slow.content, [{ type: "text", text: "slow" }]);
  assert.ok(t.lines().includes("answered error"), "Oriel declined the CLI's question");
  await host.close();
  assert.equal(alive(host.pid), false);
  assert.equal(existsSync(host.dir), false);
  t.done();
});

test("refuses a tool off the list, or a name Claude Code would read as another, before anything is sent", async () => {
  const fine = setup();
  const opened = await openToolHost({
    ...fine.options,
    tools: [...fine.options.tools, { server: "teams", tool: "_echo" }],
  });
  assert.ok(unsent(await failed(opened.call({ server: "teams", tool: "delete_all", args: {} }))));
  assert.ok(unsent(await failed(opened.call({ server: "teams", tool: "_echo", args: {} }))));
  assert.deepEqual(fine.calls(), []);
  await opened.close();
  fine.done();
});

for (const [why, fake] of [
  ["a version before mcp_call", { version: "2.1.300" }],
  ["no mcp_call capability", { capability: false }],
  ["hooks on", { hooksOn: true }],
  ["another server", { servers: [grant, { name: "mail", url: "https://mail.example/mcp" }] }],
  ["a server moved", { servers: [{ ...grant, url: "https://evil.example/mcp" }] }],
  ["a server that needs signing in", { servers: [{ ...grant, status: "needs-auth" }] }],
] as const)
  test(`refuses to start: ${why}, and sends nothing`, async () => {
    const t = setup(fake);
    const error = await failed(openToolHost(t.options));
    assert.ok(error instanceof HostRefused && unsent(error), String(error));
    assert.deepEqual(t.calls(), []);
    t.done();
  });

test("a start that never answers is stopped at its deadline", async () => {
  const t = setup({ silentStart: true }, { startMs: 200 });
  const error = await failed(openToolHost(t.options));
  assert.ok(error instanceof HostRefused);
  t.done();
});

test("a run that ends mid-call: the call fails as sent, the one queued is never sent, and the process tree dies even when it ignores SIGTERM", async () => {
  const t = setup({ ignoreTerm: true, descendant: true });
  const host = await openToolHost(t.options);
  const run = new AbortController();
  const outCall = host.call({ server: "teams", tool: "hang", args: {} }, run.signal);
  const queued = host.call({ server: "teams", tool: "echo", args: {} }, run.signal);
  await t.out;
  run.abort();
  const [first, second] = await Promise.all([failed(outCall), failed(queued)]);
  assert.ok(mayHaveLanded(first), String(first));
  assert.ok(unsent(second), String(second));
  await host.close();
  const descendant = Number(
    t
      .lines()
      .find((line) => line.startsWith("descendant "))
      ?.slice(11),
  );
  assert.ok(descendant > 0);
  const outlived = alive(descendant);
  if (outlived) process.kill(descendant, "SIGKILL");
  assert.equal(alive(host.pid), false);
  assert.equal(outlived, false, "the CLI's own child is gone too");
  assert.equal(existsSync(host.dir), false);
  assert.ok(t.lines().includes("term"), "it was asked to stop first");
  assert.ok(unsent(await failed(host.call({ server: "teams", tool: "echo", args: {} }))));
  assert.deepEqual(t.calls(), ["call hang not-for-model"]);
  t.done();
});

test("a queued call whose own run ends is never sent, while the call ahead, and the host, go on", async () => {
  const t = setup();
  const calls = reopening("teams", () => openToolHost(t.options));
  const ahead = calls.call({ tool: "slow", args: {} });
  const run = new AbortController();
  const queued = calls.call({ tool: "echo", args: { q: "cancelled" } }, run.signal);
  await t.out;
  run.abort();
  assert.ok(unsent(await failed(queued)));
  assert.deepEqual((await ahead).content, [{ type: "text", text: "slow" }]);
  await calls.call({ tool: "echo", args: { q: "next" } });
  assert.deepEqual(t.calls(), ["call slow not-for-model", "call echo not-for-model"]);
  calls.close();
  t.done();
});

test("up to four reads go out together, a write waits until the reads out are answered, and a read asked after it waits for it", async (context) => {
  const t = setup(
    { heldMs: 300 },
    {
      tools: [
        { server: "teams", tool: "held", read: true },
        { server: "teams", tool: "keep" },
      ],
    },
  );
  const host = await openToolHost(t.options);
  context.after(() => host.close());
  const read = () => host.call({ server: "teams", tool: "held", args: {} });
  const reads = [read(), read(), read(), read(), read()];
  const write = host.call({ server: "teams", tool: "keep", args: {} });
  const after = read();
  for (const each of await Promise.all([...reads, write, after]))
    assert.deepEqual(each.content, [{ type: "text", text: "held" }]);
  const held = "call held not-for-model";
  const keep = "call keep not-for-model";
  assert.deepEqual(
    t.calls(),
    [
      [held, held, held, held, "released"],
      [held, "released"],
      [keep, "released"],
      [held, "released"],
    ].flat(),
  );
  await host.close();
  t.done();
});

test("a call past its deadline fails as sent and closes the host", async () => {
  const t = setup({}, { callMs: 150 });
  const host = await openToolHost(t.options);
  assert.ok(mayHaveLanded(await failed(host.call({ server: "teams", tool: "hang", args: {} }))));
  assert.ok(unsent(await failed(host.call({ server: "teams", tool: "echo", args: {} }))));
  await host.close();
  assert.equal(alive(host.pid), false);
  t.done();
});

test("the CLI dying mid-call fails that call as sent, and the next as unsent", async () => {
  const t = setup();
  const host = await openToolHost(t.options);
  assert.ok(mayHaveLanded(await failed(host.call({ server: "teams", tool: "crash", args: {} }))));
  assert.ok(unsent(await failed(host.call({ server: "teams", tool: "echo", args: {} }))));
  await host.close();
  assert.equal(existsSync(host.dir), false);
  t.done();
});

test("a tool's own failure is its answer, and a server the CLI lost is a call never sent", async () => {
  const t = setup();
  const host = await openToolHost({
    ...t.options,
    tools: [...t.options.tools, { server: "gone", tool: "echo" }],
  });
  const answer = await host.call({ server: "teams", tool: "fails", args: {} });
  assert.equal(answer.isError, true);
  assert.match(JSON.stringify(answer.content), /Issue does not exist/);
  assert.ok(unsent(await failed(host.call({ server: "gone", tool: "echo", args: {} }))));
  await host.close();
  t.done();
});
