// The Slack stand-in answers as the real server's tools do, from Ferrowick
// in memory, and its writes change only its own copy, or, with a journal,
// every process's that shares it. No process starts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { slackServer, slackTools } from "@oriel/slack";
import { slackInfo, slackStandIn } from "@oriel/slack/standin";
import { journaled } from "./journal.ts";
import { standInServer } from "./mcp.ts";

const weather = "C0FW1WEATHR";

const call = async (
  server: ReturnType<typeof standInServer>,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const answer = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.ok(answer && "result" in answer);
  const result = answer.result as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]?.text ?? "";
  return {
    error: result.isError === true,
    text,
    body: (result.isError ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
};

test("it reports the real server's name, and every tool Oriel's entry reads and writes with", async () => {
  const server = standInServer(slackInfo, slackStandIn());
  const opened = await server.handle({ jsonrpc: "2.0", id: 1, method: "server/discover" });
  assert.ok(opened && "result" in opened);
  const meta = opened.result._meta as Record<string, { name: string }>;
  assert.equal(meta["io.modelcontextprotocol/serverInfo"]?.name, slackServer.reports);
  const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(listed && "result" in listed);
  const tools = listed.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
  for (const name of slackServer.reads)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, true, name);
  for (const name of slackServer.writes)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, false, name);
  assert.equal(tools.length, 19, "Slack's default tools, by name");
});

test("it lists the person's channels, and a channel's history by cursor", async () => {
  const server = standInServer(slackInfo, slackStandIn());
  const channels = await call(server, slackTools.channels);
  assert.deepEqual(
    (channels.body.channels as { id: string }[]).map((each) => each.id),
    [weather],
  );
  const first = await call(server, slackTools.history, { channel_id: weather, limit: 3 });
  const cursor = (first.body.response_metadata as { next_cursor: string }).next_cursor;
  assert.equal((first.body.messages as unknown[]).length, 3);
  const second = await call(server, slackTools.history, { channel_id: weather, limit: 3, cursor });
  const ts = (body: typeof first.body) => (body.messages as { ts: string }[]).map((m) => m.ts);
  assert.ok(ts(second.body).every((each) => !ts(first.body).includes(each)));
  const missing = await call(server, slackTools.history, { channel_id: "C0NOWHERE01" });
  assert.equal(missing.error, true);
  assert.match(missing.text, /channel_not_found/);
});

test("a post lands in its own copy, and in every process's that shares its journal", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-slack-standin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const journal = join(dir, "journal.jsonl");
  const writing = standInServer(slackInfo, journaled(slackStandIn(), journal));
  const reading = standInServer(slackInfo, journaled(slackStandIn(), journal));
  const alone = standInServer(slackInfo, slackStandIn());
  const posted = await call(writing, slackTools.send, { channel_id: weather, message: "Hello" });
  const context = posted.body.message_context as { message_ts: string; channel_id: string };
  assert.equal(context.channel_id, weather);
  assert.match(String(posted.body.message_link), /\/archives\/C0FW1WEATHR\/p[0-9]{16}$/);
  const latest = async (server: typeof writing) =>
    (
      (await call(server, slackTools.history, { channel_id: weather, limit: 1 })).body.messages as {
        ts: string;
        text: string;
      }[]
    )[0];
  assert.equal((await latest(reading))?.text, "Hello");
  assert.equal((await latest(reading))?.ts, context.message_ts);
  assert.notEqual((await latest(alone))?.text, "Hello");
  const elsewhere = await call(writing, slackTools.send, {
    channel_id: "C0FW2RANDOM",
    message: "Hi",
  });
  assert.equal(elsewhere.error, true, "only in the person's channels");
});
