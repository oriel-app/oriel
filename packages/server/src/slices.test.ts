// Release slices on the server (the scope-lab spike): a turn's proposal is
// stored with it and shown with Oriel's figures; a cut's figures come from
// the index with no model call; and a cut becomes a change set that moves
// the deferred items to a new epic, approved and reverted like any other.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { DiffView, SliceFiguresView, ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

const proposal = {
  slices: [
    {
      name: "Wallets and the way out",
      defer: ["jira:SYN-98", "jira:SYN-57"],
      keeps: ["Pay with a phone wallet on the website [[jira:SYN-23]]."],
      loses: ["No promo codes at checkout [[jira:SYN-98]]."],
    },
    {
      name: "Wallets only",
      defer: ["jira:SYN-98", "jira:SYN-57", "jira:SYN-99"],
      keeps: ["Pay with a phone wallet [[jira:SYN-23]]."],
      loses: ["Returning passengers type their card again [[jira:SYN-99]]."],
    },
  ],
  needs: [{ item: "jira:SYN-99", on: "legal's consent copy", from: ["jira:SYN-99"] }],
};

const slicing =
  (input: unknown): Script =>
  async (bindings) => ({ value: (await bindings.read("slices", [input])).value });

async function sliced(t: TestContext, input: unknown = proposal) {
  const app = await testApp(t, {
    writes: true,
    plan: () => [{ run: "slices" }, { text: "Here are two slices." }],
    scripts: { slices: slicing(input) },
  });
  const site = app.site;
  assert.ok(site);
  const { id: workstreamId } = json<{ id: string }>(await app.post("/api/workstreams", checkout));
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Slice it" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "slices");
  return { ...app, site, threadId, view, entry };
}

test("a turn's slices are stored with it and shown with Oriel's figures", async (t) => {
  const { entry, view, app } = await sliced(t);
  assert.ok(entry?.kind === "slices");
  const first = entry.slices.slices[0];
  assert.deepEqual(first?.figures.deferred, { items: 2, points: 6, unestimated: 0 });
  assert.ok(entry.slices.items.every((item) => item.id.startsWith("jira:SYN-")));
  assert.ok(!entry.slices.items.some((item) => item.id === "jira:SYN-1"), "the epic isn't cut");
  assert.equal(entry.slices.stale, null);
  assert.equal(
    entry.slices.later?.name,
    "Checkout v2: phone wallets and saved cards — next release",
  );
  // Every item it names resolves as a chip.
  const { chips } = await view();
  for (const item of entry.slices.items) assert.ok(chips[item.id], item.id);
  const counted = app.telemetry().filter((e) => e.name.startsWith("slices."));
  assert.deepEqual(
    counted.map((e) => [e.name, e.data["count"]]),
    [["slices.shown", 2]],
  );
});

test("a cut's figures are computed again from the index for any toggle", async (t) => {
  const { entry, get, threadId } = await sliced(t);
  assert.ok(entry?.kind === "slices");
  const figures = async (defer: string) =>
    json<SliceFiguresView>(
      await get(`/api/threads/${threadId}/slices/${entry.slices.id}/figures?defer=${defer}`),
    );
  const promo = await figures("jira:SYN-98");
  assert.deepEqual(promo.deferred, { items: 1, points: 1, unestimated: 0 });
  // An unestimated story deferred counts apart, as no estimate.
  const cards = await figures("jira:SYN-98,jira:SYN-99");
  assert.deepEqual(cards.deferred, { items: 2, points: 1, unestimated: 1 });
  assert.equal(cards.kept.items + cards.deferred.items, promo.kept.items + promo.deferred.items);
  // Anything not an item ID is ignored, never an error.
  assert.deepEqual((await figures("nonsense")).deferred, { items: 0, points: 0, unestimated: 0 });
});

test("a cut becomes a change set that moves the deferred items to a new epic, once", async (t) => {
  const app = await sliced(t);
  const { entry, threadId, post, site } = app;
  assert.ok(entry?.kind === "slices");
  const cut = (defer: string[]) =>
    post(`/api/threads/${threadId}/slices/${entry.slices.id}/cut`, {
      defer,
      later: "Checkout v2 — next release",
      toggled: true,
    });
  const made = await cut(["jira:SYN-98", "jira:SYN-57"]);
  assert.equal(made.status, 200);
  const { changeSet } = json<{ changeSet: string }>(made);
  const diff = json<DiffView>(await post(`/api/change-sets/${changeSet}/diff`));
  assert.deepEqual(
    diff.lines.map((line) => [line.kind, line.makes]),
    [
      ["create", "epic"],
      ["change", null],
      ["change", null],
    ],
  );
  assert.deepEqual(
    diff.lines
      .slice(1)
      .map((line) => /^Move .*\((SYN-\d+)\) .* to the new epic/.exec(line.sentence)?.[1]),
    ["SYN-57", "SYN-98"],
  );
  // The thread shows it under the slices.
  const kinds = (await app.view()).entries.map((e) => e.kind);
  assert.deepEqual(kinds.slice(kinds.indexOf("slices")), ["slices", "done", "change-set"]);
  // A second cut waits for the first to be decided.
  assert.equal((await cut(["jira:SYN-98"])).status, 409);
  // Once approval applies it, the stories move; reverted, they move back.
  app.advance(1000);
  await post(`/api/change-sets/${changeSet}/approve`, { hash: diff.hash });
  const epic = site.issue("SYN-98")?.epic;
  assert.ok(epic && epic !== "SYN-1");
  assert.equal(site.issue(epic)?.summary, "Checkout v2 — next release");
  assert.equal(site.issue("SYN-57")?.epic, epic);
  const { revert } = json<{ revert: string }>(await post(`/api/change-sets/${changeSet}/revert`));
  const back = json<DiffView>(await post(`/api/change-sets/${revert}/diff`));
  app.advance(1000);
  await post(`/api/change-sets/${revert}/approve`, { hash: back.hash });
  assert.equal(site.issue("SYN-98")?.epic, "SYN-1");
  assert.equal(site.issue("SYN-57")?.epic, "SYN-1");
  const cuts = app.app.telemetry().filter((e) => e.name === "slices.cut");
  assert.deepEqual(
    cuts.map((e) => e.data),
    [{ threadId, deferred: 2, toggled: true }],
  );
});

test("a cut names only the slices' items", async (t) => {
  const { entry, threadId, post } = await sliced(t);
  assert.ok(entry?.kind === "slices");
  const reply = await post(`/api/threads/${threadId}/slices/${entry.slices.id}/cut`, {
    defer: ["jira:SYN-45"],
    later: "Later",
    toggled: true,
  });
  assert.equal(reply.status, 400);
});

test("refused slices show nothing, and are counted", async (t) => {
  const { entry, app } = await sliced(t, { slices: [proposal.slices[0]] });
  assert.equal(entry, undefined);
  const counted = app.telemetry().filter((e) => e.name.startsWith("slices."));
  assert.deepEqual(
    counted.map((e) => e.name),
    ["slices.refused"],
  );
});
