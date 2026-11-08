import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryTransport, readOnly, type Transport } from "./transport.ts";

const site = "https://oriel.atlassian.net";

// A fetch that answers from a list and keeps what it was sent.
function fetchFrom(...responses: Response[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { fetch: fake as typeof fetch, sent };
}

test("only https origins and /rest/ paths are accepted", async () => {
  const { fetch, sent } = fetchFrom();
  for (const bad of ["http://oriel.atlassian.net", "https://oriel.atlassian.net/wiki", "nope"])
    assert.throws(() => memoryTransport(bad, fetch), RangeError);
  const transport = memoryTransport(`${site}/`, fetch);
  for (const path of [
    "//evil.example/rest/api/3/myself",
    "/wiki/api",
    "https://evil.example/rest/",
  ])
    await assert.rejects(transport({ method: "GET", path }), RangeError);
  assert.equal(sent.length, 0);
});

test("the read side sends only reads, even through a cast", async () => {
  const sent: string[] = [];
  const read = readOnly(async (request) => {
    sent.push(`${request.method} ${request.path}`);
    return { status: 200, body: null };
  });
  const transport = read as Transport;
  await transport({ method: "GET", path: "/rest/api/3/myself" });
  await transport({ method: "POST", path: "/rest/api/3/search/jql", body: {} });
  for (const write of [
    { method: "POST" as const, path: "/rest/api/3/issue" },
    { method: "POST" as const, path: "/rest/api/3/search/jql/../../issue" },
    { method: "PUT" as const, path: "/rest/api/3/issue/SYN-1" },
    { method: "DELETE" as const, path: "/rest/api/3/issue/SYN-1" },
  ])
    await assert.rejects(transport(write));
  assert.deepEqual(sent, ["GET /rest/api/3/myself", "POST /rest/api/3/search/jql"]);
});
