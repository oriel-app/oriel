// Thread titles: the model's few words once they arrive, and the first
// message clipped until then, or if they never do.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { ProviderError, type Titler } from "@oriel/agent";
import type { GroupView, StreamEvent, ThreadSummaryView, ThreadView } from "@oriel/web/view";
import { json, testApp } from "./testing.ts";
import { clippedTitle } from "./views.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

const longAsk =
  "I'm meeting the payments team tomorrow morning and want to walk in knowing where checkout stands. Which stories in this epic have nobody on them?";

test("a title is the first line, or the sentences that fit, or words up to an ellipsis", () => {
  assert.equal(clippedTitle("What's in here?"), "What's in here?");
  assert.equal(clippedTitle("  Estimate the   new stories.  "), "Estimate the new stories");
  assert.equal(clippedTitle("Plan kiosk wallets:\n- tap to pay\n- receipts"), "Plan kiosk wallets");
  assert.equal(
    clippedTitle("Hi! Which stories here need owners? Also check the dates on each of them."),
    "Hi! Which stories here need owners?",
  );
  // A greeting alone isn't a title: too few words for the line.
  assert.equal(
    clippedTitle("Hi! Quick one — can you tell me what SYN-45 asks us to build?"),
    "Hi! Quick one — can you tell me what SYN-45 asks us to…",
  );
  assert.equal(
    clippedTitle(longAsk),
    "I'm meeting the payments team tomorrow morning and want to…",
  );
  assert.equal(clippedTitle("\n \n"), null);
  // Punctuation alone is no title.
  assert.equal(clippedTitle("..."), null);
  assert.equal(clippedTitle(".".repeat(80)), null);
  // A family or a flag is one character, never split.
  const family = "👨‍👩‍👧".repeat(70);
  assert.equal(clippedTitle(family), `${"👨‍👩‍👧".repeat(59)}…`);
  // Sentences end at full-width marks too.
  const asked =
    "チェックアウトのエピックで見積もりがまだないストーリーと担当者がいないストーリーはどれですか？";
  assert.equal(
    clippedTitle(`${asked}${"一覧にしてください。".repeat(4)}`),
    `${asked}一覧にしてください`,
  );
  // One long word is cut whole, by character, never inside an emoji.
  const word = "🙂".repeat(70);
  assert.equal(clippedTitle(word), `${"🙂".repeat(59)}…`);
  for (const text of [longAsk, word, "a ".repeat(100)])
    assert.ok([...(clippedTitle(text) ?? "")].length <= 60);
});

// A titler the test answers by hand, which records what it was asked.
function heldTitler() {
  const asked: string[] = [];
  const answers: PromiseWithResolvers<string | null>[] = [];
  const titler: Titler = (text) => {
    asked.push(text);
    const answer = Promise.withResolvers<string | null>();
    answers.push(answer);
    return answer.promise;
  };
  return { titler, asked, answers };
}

async function opened(t: TestContext, titler?: Titler) {
  const app = await testApp(t, titler ? { titler } : {});
  const group = json<{ id: string }>(await app.post("/api/groups", checkout));
  const reply = await app.post(`/api/groups/${group.id}/threads`, { text: longAsk });
  assert.equal(reply.status, 201);
  const { id } = json<{ id: string }>(reply);
  const titles = async () => ({
    thread: json<ThreadView>(await app.get(`/api/threads/${id}`)).title,
    inbox: json<{ threads: ThreadSummaryView[] }>(await app.get("/api/threads")).threads.map(
      (thread) => thread.title,
    ),
    group: json<GroupView>(await app.get(`/api/groups/${group.id}`)).threads.map(
      (thread) => thread.title,
    ),
  });
  return { ...app, id, groupId: group.id, titles };
}

test("the model's title replaces the clipped message on every list, and pages hear", async (t) => {
  const held = heldTitler();
  const app = await opened(t, held.titler);
  // Only the person's message goes to the titler.
  assert.deepEqual(held.asked, [longAsk]);
  const clipped = clippedTitle(longAsk);
  assert.deepEqual(await app.titles(), { thread: clipped, inbox: [clipped], group: [clipped] });

  const reply = await app.get(`/api/threads/${app.id}/events`);
  const stream = reply.stream?.[Symbol.asyncIterator]();
  assert.ok(stream);
  const anyReply = await app.get("/api/threads/events");
  const anyStream = anyReply.stream?.[Symbol.asyncIterator]();
  assert.ok(anyStream);
  await anyStream.next();
  const statuses = async (): Promise<Extract<StreamEvent, { type: "status" }>> => {
    for (;;) {
      const next: IteratorResult<string> = await stream.next();
      assert.ok(!next.done);
      const data = /^data: (.*)$/m.exec(next.value)?.[1];
      if (data === undefined) continue;
      const event = JSON.parse(data) as StreamEvent;
      if (event.type === "status") return event;
    }
  };
  assert.equal((await statuses()).title, clipped);

  held.answers[0]?.resolve("Unowned checkout stories");
  await app.app.settled();
  assert.deepEqual(await app.titles(), {
    thread: "Unowned checkout stories",
    inbox: ["Unowned checkout stories"],
    group: ["Unowned checkout stories"],
  });
  // The thread's page hears the new title; the lists hear a thread moved.
  assert.equal((await statuses()).title, "Unowned checkout stories");
  assert.match((await anyStream.next()).value ?? "", /"type":"threads"/);
  await stream.return?.();
  await anyStream.return?.();

  // A later message doesn't title the thread again.
  await app.post(`/api/threads/${app.id}/messages`, { text: "And the gift card stories?" });
  await app.app.settled();
  assert.equal(held.asked.length, 1);
  assert.equal((await app.titles()).thread, "Unowned checkout stories");
});

test("a thread from nothing is titled from its first message", async (t) => {
  const held = heldTitler();
  const app = await testApp(t, { titler: held.titler });
  const reply = await app.post("/api/threads", { text: "Plan kiosk wallets: an epic and stories" });
  assert.equal(reply.status, 201);
  const { id } = json<{ id: string }>(reply);
  assert.deepEqual(held.asked, ["Plan kiosk wallets: an epic and stories"]);
  held.answers[0]?.resolve("Kiosk wallets plan");
  await app.app.settled();
  assert.equal(json<ThreadView>(await app.get(`/api/threads/${id}`)).title, "Kiosk wallets plan");
});

test("a title that fails, or can't be one, leaves the clipped message, and says why in the log", async (t) => {
  const failing = heldTitler();
  const app = await opened(t, failing.titler);
  failing.answers[0]?.reject(
    new ProviderError("The model provider refused the title request (HTTP 529)"),
  );
  await app.app.settled();
  assert.equal((await app.titles()).thread, clippedTitle(longAsk));
  assert.deepEqual(
    app.logged.filter((l) => l.message === "title: failed").map((l) => l.fields),
    [
      {
        error: "The model provider refused the title request (HTTP 529)",
        thread_id: app.id,
      },
    ],
  );

  const unusable = heldTitler();
  const other = await opened(t, unusable.titler);
  unusable.answers[0]?.resolve(null);
  await other.app.settled();
  assert.equal((await other.titles()).thread, clippedTitle(longAsk));
  assert.equal(other.logged.filter((l) => l.message === "title: unusable answer").length, 1);
});

test("without a titler, a title is the first message, clipped", async (t) => {
  const app = await opened(t);
  await app.app.settled();
  assert.equal((await app.titles()).thread, clippedTitle(longAsk));
});

test("closing stops a title being written", async (t) => {
  const held = heldTitler();
  let signal: AbortSignal | null = null;
  const titler: Titler = (text, options) => {
    signal = options.signal;
    return held.titler(text, options);
  };
  const app = await opened(t, titler);
  const closed = app.app.close();
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  held.answers[0]?.resolve("Too late");
  await closed;
});
