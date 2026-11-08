// OA-123, fixed in c27653bc (#91): clicking a link to the thread already
// open reloaded it, losing the draft typed in it and the panel beside it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import { changeSetView, threadView } from "../testing.ts";

const threadId = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";

function run(model: Model, ...msgs: Msg[]): [Model, Effect[]] {
  let effects: Effect[] = [];
  for (const msg of msgs) [model, effects] = update(model, msg);
  return [model, effects];
}

const clicked = (route: Route): Msg => ({ type: "linkClicked", route });

// A thread's page, loaded, with a draft typed and an item open in the panel.
function onThread(): Model {
  const [model] = run(
    init({ page: "thread", id: threadId, item: "jira:SYN-1" })[0],
    {
      type: "replied",
      tag: { kind: "thread", id: threadId },
      ok: true,
      body: threadView({ id: threadId, changeSets: [changeSetView({ id: setId })] }),
    },
    { type: "thread", msg: { type: "draftChanged", text: "Half a thought" } },
  );
  return model;
}

test("a link to the thread already open makes no request and leaves it as it is", () => {
  const model = onThread();
  const [after, effects] = update(model, clicked({ page: "thread", id: threadId }));
  assert.deepEqual(effects, []);
  assert.equal(after, model);
  assert.equal(after.thread?.draft, "Half a thought");
  assert.equal(after.panel?.id, "jira:SYN-1");
});
