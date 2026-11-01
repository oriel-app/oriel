// Every change to the workspace reaches the pages watching it the same way,
// whoever made it: each of Oriel's own actions publishes once, so a group's
// page open in another tab hears a change made here (OA-78).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GroupSummary, StreamEvent } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

const changed = 'data: {"type":"threads"}\n\n';

// The workspace's stream, after its opening line, and whether anything more
// is waiting on it now.
async function watch(app: Awaited<ReturnType<typeof testApp>>) {
  const reply = await app.get("/api/threads/events");
  assert.ok(reply.stream);
  const stream = reply.stream[Symbol.asyncIterator]();
  assert.equal((await stream.next()).value, "retry: 2000\n\n");
  const quiet = async () => {
    let told = false;
    const next = stream.next().then((result) => {
      told = true;
      return result;
    });
    await new Promise(setImmediate);
    return { told, next };
  };
  return { stream, quiet };
}

test("a change to a group no thread works on reaches every page, once", async (t) => {
  const app = await testApp(t);
  const { id } = json<GroupSummary>(
    await app.post("/api/groups", {
      kind: "picked",
      name: "Launch",
      items: ["jira:SYN-3", "jira:SYN-10"],
    }),
  );
  const { stream, quiet } = await watch(app);
  await app.post(`/api/groups/${id}/remove`, { items: ["jira:SYN-10"] });
  assert.equal((await stream.next()).value, changed);
  await app.post(`/api/groups/${id}/rename`, { name: "Beta" });
  assert.equal((await stream.next()).value, changed);
  const after = await quiet();
  assert.equal(after.told, false);
  await stream.return?.();
});

test("a move that only adds a marker reaches every page, and the thread's own its marker", async (t) => {
  const app = await testApp(t);
  const { id: groupId } = json<GroupSummary>(
    await app.post("/api/groups", { kind: "picked", name: "Launch", items: ["jira:SYN-3"] }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Hi" }),
  );
  await app.app.settled();
  const own = (await app.get(`/api/threads/${threadId}/events`)).stream;
  assert.ok(own);
  const ownStream = own[Symbol.asyncIterator]();
  const event = async () => {
    const data = /^data: (.*)$/m.exec(String((await ownStream.next()).value))?.[1];
    return data === undefined ? null : (JSON.parse(data) as StreamEvent);
  };
  // What it had, up to its status.
  while ((await event())?.type !== "status");
  const { stream, quiet } = await watch(app);
  await app.post(`/api/groups/${groupId}/add`, { items: ["jira:SYN-10"] });
  assert.equal((await stream.next()).value, changed);
  assert.equal((await quiet()).told, false);
  // Its own page shows the marker, and hears the rest of the workspace changed.
  const marker = await event();
  assert.ok(marker?.type === "entry" && marker.entry.kind === "marker");
  assert.deepEqual(await event(), { type: "threads" });
  await stream.return?.();
  await ownStream.return?.();
});
