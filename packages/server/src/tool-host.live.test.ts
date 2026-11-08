// Sync, an item's read, a change set's diff and its replay, through the
// routes, on the real Claude Code's tool host (decision 0060) and the dev
// stand-ins of Atlassian's and Slack's servers (packages/standin-mcp), which
// the CLI starts itself. No model runs, so the CLI needs no sign-in: it
// keeps its state in a folder of the test's own, never the person's
// `~/.claude`. Skipped unless ORIEL_LIVE_CLAUDE_CODE=1. Each step's time is
// printed, for a PR's before and after.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeCodeServerCalls, locateClaudeCode } from "@oriel/agent";
import type { FoundServer } from "@oriel/core";
import { atlassianServer } from "@oriel/jira";
import { slackServer } from "@oriel/slack";
import type { DiffView, ThreadView } from "@oriel/web/view";
import { fakeAgent } from "./servers/testing.ts";
import { json, type Script, testApp } from "./testing.ts";

const live = process.env.ORIEL_LIVE_CLAUDE_CODE === "1";
const skip = live ? false : "set ORIEL_LIVE_CLAUDE_CODE=1 to start the real Claude Code";
const standIn = fileURLToPath(new URL("../../standin-mcp/src/main.ts", import.meta.url));

const found = (name: string, reports: string, tools: readonly string[]): FoundServer => ({
  name,
  status: "connected",
  reports,
  url: null,
  command: `node ${standIn} ${name}`,
  tools,
  local: { command: "node", args: [standIn, name] },
});

async function world(t: TestContext, script: Script) {
  const cli = locateClaudeCode(process.env);
  assert.ok(cli, "Claude Code is installed");
  const folder = mkdtempSync(join(tmpdir(), "oriel-tool-host-flow-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const config = join(folder, "claude");
  const journal = (name: string) => join(folder, `${name}.jsonl`);
  const servers = [
    found("atlassian", atlassianServer.reports, [
      ...atlassianServer.reads,
      ...atlassianServer.writes,
    ]),
    found("slack", slackServer.reports, [...slackServer.reads, ...slackServer.writes]),
  ];
  const opened: { close(): void }[] = [];
  t.after(() => {
    for (const each of opened) each.close();
  });
  const it = await testApp(t, {
    jira: false,
    discover: fakeAgent(() => servers).discover,
    // The stand-ins at their own command, as ORIEL_DEV_STANDINS has them.
    knownServers: [
      {
        kind: "jira",
        server: { ...atlassianServer, at: { command: `node ${standIn} atlassian` } },
      },
      { kind: "slack", server: { ...slackServer, at: { command: `node ${standIn} slack` } } },
    ],
    plan: () => [{ run: "script" }],
    scripts: { script },
    callServer: async (server, tools) => {
      const calls = claudeCodeServerCalls(
        { path: cli, version: "" },
        {
          server: {
            name: server.name,
            dev: {
              name: server.name,
              command: "node",
              args: [standIn, server.name, "--journal", journal(server.name)],
            },
          },
          tools,
          env: { ...process.env, CLAUDE_CONFIG_DIR: config },
          log: () => {},
        },
      );
      opened.push(calls);
      return { agent: { id: "claude-code", name: "Claude Code", kind: "claude-code" }, calls };
    },
  });
  await it.app.settled();
  await it.post("/api/servers/look");
  const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
    const at = performance.now();
    const done = await work();
    console.log(`${label}: ${Math.round(performance.now() - at)} ms`);
    return done;
  };
  const turnOn = async (kind: string, server: string) => {
    const on = await it.post("/api/actions/source.on", { kind, server });
    assert.equal(on.status, 200);
    await it.app.settled();
  };
  return { ...it, timed, turnOn };
}

test("sync, read, diff and replay through the tool host on the stand-ins", { skip }, async (t) => {
  const rename: Script = async () => ({
    value: null,
    writes: [
      ["jira.setSummary", ["jira:SYN-10", "Checkout through the tool host"]],
      ["jira.setStatus", ["jira:SYN-10", "In Progress"]],
      // Its ID is found among the issue's comments, read before and after.
      ["jira.addComment", ["jira:SYN-10", "Renamed through the tool host."]],
    ],
  });
  const it = await world(t, rename);
  await it.timed("jira sync (turned on)", () => it.turnOn("jira", "atlassian"));
  assert.ok(((await it.connection("jira"))?.items ?? 0) > 20, "Jira synced");
  await it.timed("slack sync (turned on)", () => it.turnOn("slack", "slack"));
  assert.ok(((await it.connection("slack"))?.items ?? 0) > 10, "Slack synced");
  const read = await it.timed("jira item read", () => it.get("/api/items/jira%3ASYN-10"));
  assert.equal(read.status, 200);

  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename it" }),
  );
  await it.app.settled();
  const view = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = view.entries.find((each) => each.kind === "change-set");
  assert.ok(entry?.kind === "change-set");
  const shown = await it.timed("change-set diff", () =>
    it.post(`/api/change-sets/${entry.changeSetId}/diff`),
  );
  assert.equal(shown.status, 200);
  const diff = json<DiffView>(shown);
  it.advance(1000);
  await it.timed("apply (approve and replay)", async () => {
    const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
      hash: diff.hash,
    });
    assert.equal(json<{ changeSet: { status: string } }>(approved).changeSet.status, "applied");
    await it.app.settled();
  });
  const applied = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  const comment = applied.lines.at(-1)?.fields.map((field) => field.name);
  assert.match(comment?.[0] ?? "", /^comment:\d+$/, "the new comment's ID was found");
  // Written by the replay's host, and read back through the sync's.
  const after = json<{ title?: string }>(await it.get("/api/items/jira%3ASYN-10"));
  assert.equal(after.title, "Checkout through the tool host");
});
