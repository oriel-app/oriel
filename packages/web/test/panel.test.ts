// The open item lives in the page's address, but never a review link's, and
// only an item ID opens a panel.
import assert from "node:assert/strict";
import { test } from "node:test";
import { withItem } from "../src/nav.ts";
import { parseRoute } from "../src/route.ts";

const thread = "01JBZ0000000000000000000T1";

test("a review link's page never opens an item, and an address's item must be an item ID", () => {
  assert.deepEqual(parseRoute("/review/abc", "?item=jira:SYN-88"), {
    page: "review",
    token: "abc",
  });
  assert.deepEqual(withItem({ page: "review", token: "abc" }, "jira:SYN-88"), {
    page: "review",
    token: "abc",
  });
  assert.deepEqual(parseRoute(`/threads/${thread}`, "?item=../x"), { page: "thread", id: thread });
});
