// SPIKE: one suite, run on both tool hosts, against a fake Claude Code that
// is a real child process, so "kill it mid-call" kills something. The
// journal is what reached the fake's "server". Timing-based on purpose: the
// spike measures cancellation, which needs a clock.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CallFailed, HostRefused, type OpenToolHost, type ToolHostOptions } from "./contract.ts";
import { openToolHost as effectHost } from "./effect.ts";
import { openToolHost as plainHost } from "./plain.ts";

const fakeCli = fileURLToPath(new URL("./fake-cli.ts", import.meta.url));
const grant = { name: "teams", url: "https://teams.example/mcp" };

function setup(fake: Record<string, unknown> = {}, over: Partial<ToolHostOptions> = {}) {
  const folder = mkdtempSync(join(tmpdir(), "oriel-host-test-"));
  const journal = join(folder, "journal");
  const options: ToolHostOptions = {
    command: process.execPath,
    args: [fakeCli],
    env: { FAKE_CLI: JSON.stringify({ journal, servers: [grant], ...fake }) },
    grants: [grant],
    tools: ["echo", "hang", "crash", "big", "elicits"].map((tool) => ({ server: "teams", tool })),
    startMs: 5_000,
    callMs: 5_000,
    graceMs: 300,
    ...over,
  };
  const lines = () =>
    existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter(Boolean) : [];
  const calls = () => lines().filter((line) => line.startsWith("call "));
  // Waits until the fake has journalled `count` calls.
  const until = async (count: number) => {
    while (calls().length < count) await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return {
    options,
    lines,
    calls,
    until,
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

for (const [name, open] of [
  ["plain", plainHost],
  ["effect", effectHost],
] as [string, OpenToolHost][])
  describe(`tool host (${name})`, () => {
    test("calls a tool on the list, and declines what the CLI asks", async () => {
      const t = setup();
      const host = await open(t.options);
      const answer = await host.call({ server: "teams", tool: "echo", args: { q: 1 } });
      assert.deepEqual(answer.content, [{ type: "text", text: '{"q":1}' }]);
      const elicited = await host.call({ server: "teams", tool: "elicits", args: {} });
      assert.deepEqual(elicited.content, [{ type: "text", text: "declined" }]);
      await host.close();
      assert.equal(alive(host.pid), false);
      assert.equal(existsSync(host.dir), false);
      t.done();
    });

    test("refuses a tool off the list before anything is sent", async () => {
      const t = setup();
      const host = await open(t.options);
      const error = await failed(host.call({ server: "teams", tool: "delete_all", args: {} }));
      assert.ok(error instanceof CallFailed && !error.sent);
      assert.deepEqual(t.calls(), []);
      await host.close();
      t.done();
    });

    for (const [why, fake, said] of [
      ["no mcp_call", { capability: false }, /update Claude Code/],
      ["hooks on", { hooksOn: true }, /hooks/],
      ["another server", { servers: [grant, { name: "mail", url: "x" }] }, /didn't name/],
      ["moved server", { servers: [{ ...grant, url: "https://evil.example" }] }, /granted/],
    ] as const)
      test(`refuses to start: ${why}, and kills the process`, async () => {
        const t = setup(fake);
        const error = await failed(open(t.options));
        assert.ok(error instanceof HostRefused, String(error));
        assert.match(error.message, said);
        t.done();
      });

    test("a start that never answers is stopped at its deadline", async () => {
      const t = setup({ silentStart: true }, { startMs: 200 });
      const error = await failed(open(t.options));
      assert.ok(error instanceof HostRefused);
      assert.match(error.message, /in time/);
      t.done();
    });

    test("killed mid-call: the run ends, the call fails as sent, nothing queued is sent, and the process dies even when it ignores SIGTERM", async () => {
      const t = setup({ ignoreTerm: true });
      const host = await open(t.options);
      const run = new AbortController();
      const out = host.call({ server: "teams", tool: "hang", args: {} }, run.signal);
      const queued = host.call({ server: "teams", tool: "echo", args: {} }, run.signal);
      await t.until(1);
      const at = performance.now();
      run.abort();
      const [first, second] = await Promise.all([failed(out), failed(queued)]);
      const took = performance.now() - at;
      assert.ok(first instanceof CallFailed && first.sent, String(first));
      assert.ok(second instanceof CallFailed && !second.sent, String(second));
      assert.ok(took < 100, `the run's calls failed ${took} ms after it ended`);
      await host.close();
      assert.equal(alive(host.pid), false);
      assert.equal(existsSync(host.dir), false);
      assert.deepEqual(t.calls(), ["call hang"]);
      assert.ok(t.lines().includes("term"), "it was asked to stop first");
      const later = await failed(host.call({ server: "teams", tool: "echo", args: {} }));
      assert.ok(later instanceof CallFailed && !later.sent);
      assert.deepEqual(t.calls(), ["call hang"]);
      t.done();
    });

    test("a queued call whose own run ends fails at once, while the call ahead goes on", async () => {
      const t = setup();
      const host = await open(t.options, undefined);
      const ahead = host.call({ server: "teams", tool: "hang", args: {} });
      const run = new AbortController();
      const queued = host.call({ server: "teams", tool: "echo", args: {} }, run.signal);
      await t.until(1);
      run.abort();
      const error = await failed(queued);
      assert.ok(error instanceof CallFailed && !error.sent);
      const going = failed(ahead);
      await host.close();
      const gone = await going;
      assert.ok(gone instanceof CallFailed && gone.sent);
      assert.deepEqual(t.calls(), ["call hang"]);
      t.done();
    });

    test("a call past its deadline fails as sent and closes the host", async () => {
      const t = setup({}, { callMs: 150 });
      const host = await open(t.options);
      const error = await failed(host.call({ server: "teams", tool: "hang", args: {} }));
      assert.ok(error instanceof CallFailed && error.sent);
      assert.match(error.message, /longer than 150/);
      const next = await failed(host.call({ server: "teams", tool: "echo", args: {} }));
      assert.ok(next instanceof CallFailed && !next.sent);
      await host.close();
      assert.equal(alive(host.pid), false);
      t.done();
    });

    test("the CLI dying mid-call fails that call as sent, and the next as unsent", async () => {
      const t = setup();
      const host = await open(t.options);
      const error = await failed(host.call({ server: "teams", tool: "crash", args: {} }));
      assert.ok(error instanceof CallFailed && error.sent);
      const next = await failed(host.call({ server: "teams", tool: "echo", args: {} }));
      assert.ok(next instanceof CallFailed && !next.sent);
      await host.close();
      assert.equal(existsSync(host.dir), false);
      t.done();
    });

    test("an answer is capped: text only, cut and marked", async () => {
      const t = setup();
      const host = await open(t.options);
      const answer = await host.call({ server: "teams", tool: "big", args: {} });
      const texts = answer.content as { text: string }[];
      assert.equal(texts.length, 3);
      assert.equal(texts[0]!.text.length, 100_000);
      assert.equal(texts[1]!.text, "[cut by Oriel]");
      assert.match(texts[2]!.text, /dropped 1/);
      await host.close();
      t.done();
    });
  });
