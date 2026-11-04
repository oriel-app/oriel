import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ModelEvent, Provider } from "@oriel/agent";
import type { NoticedView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";

// A model that picks every signal it's offered, with one plain line each,
// and counts its passes.
function picking() {
  const passes: string[][] = [];
  const provider: Provider = {
    converse(request) {
      const read = request.messages.flatMap((m) => (m.role === "tool" ? m.results : []));
      const offered = (read[0]?.content ?? "").split("\n").flatMap((line) => {
        const match = /^\{"signal":"([^"]+)"/u.exec(line);
        return match?.[1] ? [match[1]] : [];
      });
      passes.push(offered);
      return {
        async *next(): AsyncGenerator<ModelEvent> {
          for (const signal of offered.slice(0, 4))
            yield {
              kind: "text",
              text: `${JSON.stringify({ signal, why: "Worth a look this week." })}\n`,
            };
          const usage = {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
          yield { kind: "end", stop: "done", detail: null, model: "stand-in", usage };
        },
      };
    },
  };
  return { passes, provider };
}

async function window(t: TestContext) {
  const model = picking();
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    noticer: async () => ({ provider: model.provider, model: "stand-in" }),
  });
  for (const cluster of ["10001", "10002", "10003"])
    assert.equal(
      (await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster })).status,
      201,
    );
  // The pass runs in the background; a look never waits for it.
  const look = async () => {
    for (;;) {
      const view = json<NoticedView>(await app.get("/api/noticed"));
      if (view.status !== "running") return view;
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return { app, model, look };
}

test("a look computes Oriel's signals; a pass runs once a signal set, and its cards carry Oriel's blocks", async (t) => {
  const { model, look } = await window(t);
  const view = await look();
  assert.equal(view.status, "ready");
  assert.equal(model.passes.length, 1);
  const contradicted = view.cards.find((card) => card.signal === "contradicted:jira:SYN-47");
  assert.ok(contradicted, "SYN-47 is done, and Slack names it after");
  assert.equal(contradicted.why, "Worth a look this week.");
  assert.equal(contradicted.block?.form, "rows");
  await look();
  await look();
  assert.equal(model.passes.length, 1, "nothing changed, so no second pass");
});

test("a dismissed card stays away, and a pin reruns its read on every look with no model", async (t) => {
  const { app, model, look } = await window(t);
  await look();
  assert.equal(
    (await app.post("/api/noticed/dismiss", { signal: "overloaded:amara" })).status,
    200,
  );
  const after = await look();
  assert.ok(!after.cards.some((card) => card.signal === "overloaded:amara"));
  assert.ok(model.passes.every((offered, i) => i === 0 || !offered.includes("overloaded:amara")));

  const pinned = await app.post("/api/noticed/pin", { signal: "contradicted:jira:SYN-47" });
  assert.equal(pinned.status, 201);
  const passes = model.passes.length;
  const view = await look();
  assert.equal(model.passes.length, passes);
  assert.equal(view.pins.length, 1);
  assert.equal(view.pins[0]?.block?.form, "rows");
  const { id } = json<{ id: string }>(pinned);
  assert.equal((await app.post(`/api/pins/${id}/remove`, {})).status, 200);
  assert.equal((await look()).pins.length, 0);
});

test("a fifth pin is refused, and a stray card can't be pinned or dismissed", async (t) => {
  const { app, look } = await window(t);
  const view = await look();
  const signals = view.cards.map((card) => card.signal);
  for (const signal of [...signals, ...signals].slice(0, 4))
    assert.equal((await app.post("/api/noticed/pin", { signal })).status, 201);
  assert.equal((await app.post("/api/noticed/pin", { signal: signals[0] })).status, 409);
  assert.equal((await app.post("/api/noticed/dismiss", { signal: "stalled:nothing" })).status, 404);
});
