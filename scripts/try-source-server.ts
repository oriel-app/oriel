// Jira through a source server, end to end on the person's own Claude Code or
// Codex, against packages/standin-mcp's stand-in for Atlassian's server, in
// dev only (OA-276). The agent's processes get the stand-in on their command
// line, never in the person's configuration. It looks for the person's
// servers, turns Jira on through the stand-in, syncs SYN into the index, and
// approves one change set, a scripted rename, which replays through the
// server's write tools. On Claude Code that spends a little of the person's
// plan on its smallest model; on Codex, none. The index is in memory.
// Usage: node scripts/try-source-server.ts <claude-code|codex>
import { checkCodex } from "../packages/agent/src/index.ts";
import { models as findModels } from "../packages/server/src/model.ts";
import { scriptedAgent } from "../packages/server/src/scripted-agent.ts";
import { memorySettings } from "../packages/server/src/settings.ts";
import { devStandIns } from "../packages/server/src/standins.ts";
import { json, testApp } from "../packages/server/src/testing.ts";
import type { DiffView, ThreadView } from "../packages/web/src/view.ts";

const agent = process.argv[2];
if (agent !== "claude-code" && agent !== "codex") {
  console.error("Usage: node scripts/try-source-server.ts <claude-code|codex>");
  process.exit(2);
}
const standIns = devStandIns("atlassian");
if (!standIns) throw new Error("no stand-in");
const settings = memorySettings({
  providers: [
    { id: "claude-code", kind: "claude-code", name: "Claude Code", on: agent === "claude-code" },
    { id: "codex", kind: "codex", name: "Codex", on: agent === "codex" },
  ],
});
const models = findModels({ key: null, dev: standIns.dev });
await models.look(settings.get());
if (agent === "codex" && !(await checkCodex()).ok) throw new Error("Codex isn't ready");

const quiet: (() => Promise<void>)[] = [];
const it = await testApp(
  { after: (fn) => quiet.push(fn) },
  {
    connect: {},
    models,
    settings,
    knownServers: standIns.known,
    agent: (deps) => scriptedAgent(deps, () => [{ run: "rename" }]),
    scripts: {
      rename: async () => ({
        value: null,
        writes: [["jira.setSummary", ["jira:SYN-10", "Renamed through the stand-in"]]],
      }),
    },
  },
);
const step = (what: string, started: number) =>
  console.log(`${what} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
try {
  let at = Date.now();
  await it.post("/api/servers/look");
  const servers = (await it.connections()).servers;
  const found = servers.found.find((each) => each.kind === "jira");
  if (!found)
    throw new Error(
      `${servers.agent ?? "The agent"} listed no server for Jira: ${servers.problem ?? ""}`,
    );
  step(`${servers.agent} lists ${found.server}, ${found.known}`, at);

  at = Date.now();
  const on = await it.post("/api/actions/source.on", { kind: "jira", server: found.server });
  if (on.status !== 200) throw new Error(`Jira didn't turn on: ${on.status}`);
  await it.app.settled();
  const jira = await it.connection("jira");
  if (!jira) {
    const kind = (await it.connections()).servers.kinds.find((each) => each.kind === "jira");
    throw new Error(`Jira didn't open: ${kind?.problem ?? "no reason given"}`);
  }
  step(`Jira on: ${jira?.about}, ${jira?.items} items, problem ${jira?.problem ?? "none"}`, at);
  const synced = it.app.telemetry().filter((event) => event.name === "source.server-synced");
  console.log("telemetry:", JSON.stringify(synced.map((event) => event.data)));

  at = Date.now();
  const { id: workstreamId } = json<{ id: string }>(
    await it.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id: threadId } = json<{ id: string }>(
    await it.post(`/api/workstreams/${workstreamId}/threads`, { text: "Rename SYN-10" }),
  );
  await it.app.settled();
  const thread = json<ThreadView>(await it.get(`/api/threads/${threadId}`));
  const entry = thread.entries.find((each) => each.kind === "change-set");
  if (entry?.kind !== "change-set") throw new Error("no change set");
  const diff = json<DiffView>(await it.post(`/api/change-sets/${entry.changeSetId}/diff`));
  it.advance(1000);
  const approved = await it.post(`/api/change-sets/${entry.changeSetId}/approve`, {
    hash: diff.hash,
  });
  await it.app.settled();
  const report = json<{ report?: unknown; changeSet?: { state?: string } }>(approved);
  console.log("apply:", JSON.stringify({ state: report.changeSet?.state, report: report.report }));
  const after = (await it.connection("jira"))?.items;
  const row = it.app
    .window("epic")
    .clusters.flatMap((cluster) => cluster.list)
    .find((each) => each.id === "jira:SYN-10");
  step(`approved: ${approved.status}; SYN-10 reads "${row?.title}"; ${after} items`, at);
} finally {
  for (const fn of quiet) await fn();
}
process.exit(0);
