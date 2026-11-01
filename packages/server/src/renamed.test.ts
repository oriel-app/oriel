// Workstreams were called groups until OA-98. Links and tabs from before then
// still work: a page redirects, and the API answers at its old paths.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkstreamSummary, WorkstreamView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

test("an old workstream page redirects to its new address, keeping the open item", async (t) => {
  const { get } = await testApp(t);
  const reply = await get("/groups/01JBZ0000000000000000000G1?item=jira%3ASYN-1");
  assert.equal(reply.status, 301);
  assert.equal(reply.headers.location, "/workstreams/01JBZ0000000000000000000G1?item=jira%3ASYN-1");
  assert.equal((await get("/groups/nope")).status, 404);
  assert.equal((await get("/groups")).status, 404);
});

test("the API answers at its old paths as at its new ones", async (t) => {
  const { get, post } = await testApp(t);
  const created = await post("/api/groups", {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
  });
  assert.equal(created.status, 201);
  const { id } = json<WorkstreamSummary>(created);
  const old = json<WorkstreamView>(await get(`/api/groups/${id}`));
  assert.deepEqual(old, json<WorkstreamView>(await get(`/api/workstreams/${id}`)));
  const renamed = await post(`/api/groups/${id}/rename`, { name: "Checkout" });
  assert.equal(renamed.status, 200);
  assert.deepEqual(
    json<{ workstreams: WorkstreamSummary[] }>(await get("/api/groups")).workstreams.map(
      (each) => each.name,
    ),
    ["Checkout"],
  );
  assert.equal((await get("/api/groupsx")).status, 404);
});
