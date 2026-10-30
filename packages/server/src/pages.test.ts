import assert from "node:assert/strict";
import { test } from "node:test";
import { json, testApp } from "./testing.ts";
import { webUrl } from "./views.ts";

test("the app's pages are the same shell; anything else 404s", async (t) => {
  const { get } = await testApp(t);
  const shell = String((await get("/")).body);
  for (const path of [
    "/inbox",
    "/groups/01JBZ0000000000000000000G1",
    "/threads/01JBZ0000000000000000000T1",
  ]) {
    const reply = await get(path);
    assert.equal(reply.status, 200, path);
    assert.equal(String(reply.body), shell, path);
  }
  for (const path of ["/groups/nope", "/threads/", "/inbox/x", "/review/", "/review/a/b"])
    assert.equal((await get(path)).status, 404, path);
  assert.equal((await get("/api/nope")).status, 404);
});

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
  const reply = await get("/api/groups");
  assert.deepEqual(json(reply), { groups: [] });
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
