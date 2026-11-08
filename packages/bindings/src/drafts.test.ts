// A waiting connection's drafts (decision 0051): checked by its connector's
// validator over the options it has, and held as that validator reads them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { array, object, string } from "@oriel/core";
import { waitingOf } from "./drafts.ts";

const waiting = waitingOf([
  {
    id: "01JC0NNECT10N0000000000000",
    kind: "slack",
    source: "Slack",
    why: "A channel is gone.",
    options: { channels: ["weather-disruptions", "launch-room"] },
    validator: object({ channels: array(string) }),
    preview: async () => [],
  },
]);

test("a draft holds only what its connector's validator declares", () => {
  assert.ok(waiting);
  const drafted = waiting.check({
    action: "source.configure",
    input: {
      connection: "01JC0NNECT10N0000000000000",
      options: { channels: ["random"], "Checked by Oriel": "yes" },
    },
  });
  assert.deepEqual(drafted.input, {
    connection: "01JC0NNECT10N0000000000000",
    options: { channels: ["random"] },
  });
});

test("a draft for a connection that doesn't wait, or options that don't fit, is refused", () => {
  assert.ok(waiting);
  const draft = (input: Record<string, unknown>) => () =>
    waiting.check({ action: "source.configure", input });
  assert.throws(draft({ connection: "01JC0NNECT10N0000000000001", options: {} }));
  assert.throws(
    draft({ connection: "01JC0NNECT10N0000000000000", options: { channels: "random" } }),
  );
  assert.equal(waitingOf([]), null);
});
