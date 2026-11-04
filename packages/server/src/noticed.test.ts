import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

async function window(t: TestContext, db?: string) {
  const model = picking();
  const app = await testApp(t, {
    ...(db ? { db } : {}),
    slack: { mode: "fixture" },
    noticer: async () => ({ provider: model.provider, model: "stand-in" }),
  });
  for (const cluster of ["10001", "10002", "10003"])
    assert.equal(
      (await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster })).status,
      201,
    );
  // The pass runs in the background, after the curation; a look never
  // waits for it.
  const look = async () => {
    await app.app.settled();
    return json<NoticedView>(await app.get("/api/noticed"));
  };
  return { app, model, look };
}

test("a pass runs after a sync and a curation, and its cards carry Oriel's blocks", async (t) => {
  const { app, model, look } = await window(t);
  const view = await look();
  assert.equal(view.status, "ready");
  const contradicted = view.cards.find((card) => card.signal === "contradicted:jira:SYN-47");
  assert.ok(contradicted, "SYN-47 is done, and Slack names it after");
  assert.equal(contradicted.why, "Worth a look this week.");
  assert.equal(contradicted.block?.form, "rows");

  // A dismissal changes the signals on offer, but starts no pass, and
  // neither do looks; the next curation does.
  const passes = model.passes.length;
  assert.equal(
    (await app.post("/api/noticed/dismiss", { signal: "overloaded:amara" })).status,
    200,
  );
  await look();
  await look();
  assert.equal(model.passes.length, passes);
  const [workstream] = json<{ workstreams: { id: string }[] }>(
    await app.get("/api/workstreams"),
  ).workstreams;
  assert.ok(workstream);
  const renamed = await app.post(`/api/workstreams/${workstream.id}/rename`, { name: "Boarding" });
  assert.equal(renamed.status, 200);
  await look();
  assert.equal(model.passes.length, passes + 1);
  assert.ok(!model.passes.at(-1)?.includes("overloaded:amara"));

  // Telemetry counts passes, cards and dismissals, never their words.
  const events = app.app.telemetry().filter((e) => e.name.startsWith("noticed."));
  const pass = events.find((e) => e.name === "noticed.pass");
  assert.deepEqual(pass && { ...pass.data, ms: 0, firstMs: 0 }, {
    offered: 4,
    picked: 4,
    dropped: 0,
    inputTokens: 1,
    outputTokens: 1,
    firstMs: 0,
    ms: 0,
    ok: true,
  });
  assert.ok(events.some((e) => e.name === "noticed.shown"));
  assert.deepEqual(
    events.filter((e) => e.name === "noticed.dismissed").map((e) => e.data),
    [{ kind: "overloaded" }],
  );
  assert.ok(!JSON.stringify(events).includes("Worth a look"));
});

test("a sync's end runs a pass when the signals on offer changed", async (t) => {
  const { app, model, look } = await window(t);
  await look();
  const passes = model.passes.length;
  assert.equal(
    (await app.post("/api/noticed/dismiss", { signal: "contradicted:jira:SYN-26" })).status,
    200,
  );
  const slack = await app.connection("slack");
  assert.ok(slack);
  assert.equal((await app.post(`/api/connections/${slack.id}/sync`, {})).status, 200);
  await look();
  assert.equal(model.passes.length, passes + 1);
  assert.ok(!model.passes.at(-1)?.includes("contradicted:jira:SYN-26"));
});

test("the first look after a restart shows the kept pass's cards, with no model call", async (t) => {
  const db = join(mkdtempSync(join(tmpdir(), "oriel-noticed-")), "oriel.db");
  t.after(() => rmSync(dirname(db), { recursive: true, force: true }));
  const first = await window(t, db);
  const before = await first.look();
  assert.ok(before.cards.length > 0);
  await first.app.app.close();

  let asked = 0;
  const again = await testApp(t, {
    db,
    slack: { mode: "fixture" },
    noticer: async () => {
      asked++;
      return null;
    },
  });
  const view = json<NoticedView>(await again.get("/api/noticed"));
  assert.deepEqual(
    view.cards.map((card) => card.signal),
    before.cards.map((card) => card.signal),
  );
  await again.app.settled();
  assert.equal(asked, 0, "the start's sync found the same signals, so no pass");
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

test("a card pins once, and a stray card can't be pinned or dismissed", async (t) => {
  const { app, look } = await window(t);
  const [first] = (await look()).cards;
  assert.ok(first);
  assert.equal((await app.post("/api/noticed/pin", { signal: first.signal })).status, 201);
  assert.equal((await app.post("/api/noticed/pin", { signal: first.signal })).status, 409);
  assert.equal((await app.post("/api/noticed/pin", { signal: "stalled:nothing" })).status, 404);
  assert.equal((await app.post("/api/noticed/dismiss", { signal: "stalled:nothing" })).status, 404);
});

test("with no model, the strip says so, and looks don't ask again", async (t) => {
  let asked = 0;
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    noticer: async () => {
      asked++;
      return null;
    },
  });
  await app.app.settled();
  const views = [];
  for (let i = 0; i < 3; i++) views.push(json<NoticedView>(await app.get("/api/noticed")).status);
  assert.deepEqual(views, ["no-ai", "no-ai", "no-ai"]);
  assert.equal(asked, 1);
});

test("a pass that ends on a tool call is a failure the strip shows, not an empty window", async (t) => {
  const provider: Provider = {
    converse: () => ({
      async *next(): AsyncGenerator<ModelEvent> {
        const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
        yield { kind: "call", call: { id: "c1", name: "run", input: { script: "1" } } };
        yield { kind: "end", stop: "calls", detail: null, model: "stand-in", usage };
      },
    }),
  };
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    noticer: async () => ({ provider, model: "stand-in" }),
  });
  await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10003" });
  await app.app.settled();
  const view = json<NoticedView>(await app.get("/api/noticed"));
  assert.equal(view.status, "failed");
  assert.ok(view.problem);
});
