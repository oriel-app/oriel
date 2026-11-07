// The Linear stand-in answers as Oriel's parser reads Linear's server, from
// Ferrowick's Linear in memory, and its writes change only its own copy,
// or, with a journal, every process's that shares it. No process starts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { linearServer, linearTools } from "@oriel/linear";
import { linearInfo, linearStandIn } from "@oriel/linear/standin";
import { journaled } from "./journal.ts";
import { standInServer } from "./mcp.ts";

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

test("it serves every tool Oriel's entry reads and writes with, and reads are marked read-only", async () => {
  const server = standInServer(linearInfo, linearStandIn());
  const opened = await server.handle({ jsonrpc: "2.0", id: 1, method: "server/discover" });
  assert.ok(opened && "result" in opened);
  const meta = opened.result._meta as Record<string, { name: string }>;
  assert.equal(meta["io.modelcontextprotocol/serverInfo"]?.name, linearServer.reports);
  const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(listed && "result" in listed);
  const tools = listed.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
  for (const name of linearServer.reads)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, true, name);
  for (const name of linearServer.writes)
    assert.equal(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint, false, name);
  assert.ok(!tools.some((tool) => /delete_(issue|project)/.test(tool.name)), "nothing deletes one");
});

test("it lists a team's issues by page, and refuses an argument it doesn't take", async () => {
  const server = standInServer(linearInfo, linearStandIn());
  const first = await call(server, linearTools.issues, { team: "ENG", limit: 5 });
  const info = first.body.pageInfo as { hasNextPage: boolean; endCursor: string };
  assert.equal(info.hasNextPage, true);
  const second = await call(server, linearTools.issues, {
    team: "ENG",
    limit: 5,
    after: info.endCursor,
  });
  const ids = (body: typeof first.body) => (body.issues as { identifier: string }[]).map((each) => each.identifier);
  assert.deepEqual(ids(first.body), ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"]);
  assert.deepEqual(ids(second.body), ["ENG-6", "ENG-7", "ENG-8", "ENG-9", "ENG-10"]);
  const unknown = await call(server, linearTools.issues, { teamId: "ENG" });
  assert.equal(unknown.error, true);
  assert.match(unknown.text, /unknown parameter teamId/);
});

test("a save lands in its own copy, and in every process's that shares its journal", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-linear-standin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const journal = join(dir, "journal.jsonl");
  const writing = standInServer(linearInfo, journaled(linearStandIn(), journal));
  const reading = standInServer(linearInfo, journaled(linearStandIn(), journal));
  const alone = standInServer(linearInfo, linearStandIn());
  const saved = await call(writing, linearTools.saveIssue, { team: "ENG", title: "Hello" });
  assert.equal(saved.body.identifier, "ENG-22");
  const read = async (server: typeof writing) =>
    (await call(server, linearTools.issue, { id: "ENG-22" })).body.title;
  assert.equal(await read(reading), "Hello");
  assert.equal(await read(alone), undefined);
  const nobody = await call(writing, linearTools.saveIssue, { id: "ENG-1", assignee: "Nobody" });
  assert.equal(nobody.error, true);
});
