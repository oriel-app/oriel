import assert from "node:assert/strict";
import { test } from "node:test";
import { inAppRoute } from "../src/route.ts";

const threadId = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";

// A reply's text is the model's: only a link to a thread in Oriel opens in
// the app; one made to look like it, or to the review link, doesn't.
test("a reply links to a thread or a change set in Oriel, and never elsewhere that way", () => {
  assert.deepEqual(inAppRoute(`/threads/${threadId}?changeSet=${setId}`), {
    page: "thread",
    id: threadId,
    changeSet: setId,
  });
  for (const target of [
    "/threads/new",
    `//example.com/threads/${threadId}`,
    `/threads/${threadId}/../../done`,
    `https://example.com/threads/${threadId}`,
    "/review/abc",
  ])
    assert.equal(inAppRoute(target), null, target);
});
