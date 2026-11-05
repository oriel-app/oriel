// A real HTTP client controlling a throwaway fixture server. No credentials,
// live sources, model calls or desktop window. Run: node scripts/mcp-command-try.ts
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { instant, ulid } from "../packages/core/src/ids.ts";
import { serve } from "../packages/server/src/serve.ts";
import { mcpHandler, serveMcp } from "../packages/server/src/mcp/http.ts";
import { mcpServer } from "../packages/server/src/mcp/protocol.ts";
import { outsideTools } from "../packages/server/src/mcp/tokens.ts";

const serving = await serve(0);
const connected = outsideTools({ now: () => instant(new Date()), newId: () => ulid(Date.now()) });
const bot = connected.connect("Repository bot", "act");
const server = mcpServer({
  outside: serving.app.outside,
  window: new URL(serving.url),
  version: "sol-spike",
  clock: Date.now,
});
const door = await serveMcp([0], (port) => mcpHandler({ server, tools: connected, port }));
let id = 0;
const call = async (name: string, args: Record<string, unknown>) => {
  const start = performance.now();
  const response = await fetch(door.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bot.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const answer = (await response.json()) as {
    result: {
      structuredContent: Record<string, unknown>;
      isError?: boolean;
      content: { text: string }[];
    };
  };
  console.log(
    JSON.stringify({
      call: name,
      ms: Math.round((performance.now() - start) * 100) / 100,
      result: answer.result.structuredContent ?? answer.result.content,
    }),
  );
  return answer.result;
};
try {
  const created = await serving.app.outside.dispatch(
    "workstream.create",
    { kind: "cluster", grouping: "epic", cluster: "10001" },
    { kind: "user" },
  );
  const workstream = created.workstream;
  const before = await call("workstream_checkpoint", { workstream });
  const checkpoint = before.structuredContent["data"] as {
    epoch: string;
    version: number;
    items: string[];
  };
  const command = {
    workstream,
    operation: "remove",
    items: ["jira:SYN-10"],
    expectedVersion: checkpoint.version,
    epoch: checkpoint.epoch,
    requestId: "branch-update-1",
  };
  const [first, retry] = await Promise.all([
    call("workstream_edit", command),
    call("workstream_edit", command),
  ]);
  assert.deepEqual(first.structuredContent, retry.structuredContent);
  assert.equal(first.structuredContent["status"], "applied");
  const page = await serving.app.outside.workstream(workstream);
  assert.equal(page?.changes.length, 2);
  const latest = page.changes[0];
  assert.equal(latest?.tool, "Repository bot");
  assert.ok(latest.undo);
  console.log(
    JSON.stringify({
      window: {
        version: latest.version,
        by: latest.tool,
        removed: latest.removed.map((ref) => ref.id),
        undo: latest.undo.action,
      },
    }),
  );
  const another = checkpoint.items.find((item) => item !== "jira:SYN-10");
  assert.ok(another);
  const stale = await call("workstream_edit", {
    ...command,
    items: [another],
    requestId: "stale-edit",
  });
  assert.equal(stale.structuredContent["code"], "conflict");
  assert.equal(latest.undo.action, "workstream.add");
  await serving.app.outside.dispatch.untyped("workstream.add", latest.undo.input, {
    kind: "user",
  });
  const afterUndo = await call("workstream_edit", command);
  assert.deepEqual(afterUndo.structuredContent, first.structuredContent);
  assert.ok(
    (await serving.app.outside.workstream(workstream))?.members.some(
      ({ ref }) => ref.id === "jira:SYN-10",
    ),
  );
  const reused = await call("workstream_edit", { ...command, operation: "add" });
  assert.equal(reused.isError, true);
  const restarted = await call("workstream_edit", { ...command, epoch: "previous-server" });
  assert.equal(restarted.isError, true);
  console.log(
    "Verified: one edit, identical retry receipt, attributed Undo, stale edit refused, Undo survives retry, changed request refused, old epoch refused.",
  );
} finally {
  await door.close();
  await serving.close();
}
