import assert from "node:assert/strict";
import { test } from "node:test";
import { json, testApp } from "./testing.ts";
import { webUrl } from "./views.ts";

test("a review link's page is the shell, unindexed, never cached, sending no referrer", async (t) => {
  const { get } = await testApp(t);
  const reply = await get("/review/abcDEF_-123");
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["referrer-policy"], "no-referrer");
  assert.equal(reply.headers["cache-control"], "no-store");
  assert.equal(reply.headers["x-robots-tag"], "noindex");
});

test("JSON replies carry the same security headers as pages", async (t) => {
  const { get } = await testApp(t);
  const reply = await get("/api/workstreams");
  assert.deepEqual(json(reply), { workstreams: [] });
  assert.equal(reply.headers["x-content-type-options"], "nosniff");
  assert.equal(reply.headers["cache-control"], "no-store");
  assert.match(reply.headers["content-security-policy"] ?? "", /default-src 'none'/);
});

test("only an http(s) location becomes a link", () => {
  assert.equal(
    webUrl("https://oriel.atlassian.net/browse/SYN-1"),
    "https://oriel.atlassian.net/browse/SYN-1",
  );
  assert.equal(webUrl("http://localhost:8080/x"), "http://localhost:8080/x");
  for (const location of [
    "javascript:alert(1)",
    "file:///Users/pm/notes/plan.md",
    "data:text/html,x",
    "not a url",
    "",
  ])
    assert.equal(webUrl(location), null, location);
});
