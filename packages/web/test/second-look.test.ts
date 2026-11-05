// Second look is the person's to press (decision 0054): it asks once and
// says Looking… from the press until the look shows. While a look shows, the
// change set offers only what pertains to it, and Dismiss gives back Approve
// and Reject (OA-257).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import type { SecondLookView } from "../src/view.ts";
import {
  initThread,
  shownLook,
  streamed,
  threadReplied,
  type ThreadModel,
  type ThreadMsg,
  updateThread,
} from "../src/thread.ts";
import { changeSetView, diffView, threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const setId = "01JBZ0000000000000000000C1";

const openSet = changeSetView({
  id: setId,
  status: "open",
  nextSteps: [{ kind: "approve" }, { kind: "reject" }],
  decision: null,
  revertOf: null,
  secondLook: null,
});

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

function loaded(): ThreadModel {
  let [model] = initThread(id);
  const view = threadView({ id, entries: [], lastSeq: 0, changeSets: [openSet] });
  [model] = threadReplied(model, replied({ kind: "thread", id }, view));
  [model] = threadReplied(
    model,
    replied({ kind: "diff", changeSetId: setId }, diffView({ changeSetId: setId, hash: "h" })),
  );
  return model;
}

const send = (model: ThreadModel, msg: ThreadMsg) => updateThread(model, msg);
const urls = (effects: Effect[]) => effects.map((e) => (e.type === "http" ? e.url : e.type));

// A look as the thread shows it: running, with nothing found yet.
const look = (over: Partial<SecondLookView> = {}): SecondLookView => ({
  id: "01JBZ0000000000000000000K1",
  state: "running",
  findings: [],
  companions: [],
  coverage: null,
  stale: { diff: false, items: [] },
  error: null,
  startedAt: "2026-11-05T10:00:00.000Z",
  finishedAt: null,
  dismissed: false,
  ...over,
});

// The thread as it reloads, its change set's look as given; with none
// given, it can have none, as once it is decided.
const reloaded = (model: ThreadModel, secondLook?: SecondLookView | null) => {
  const { secondLook: _, ...decided } = openSet;
  const set = secondLook === undefined ? decided : { ...openSet, secondLook };
  return threadReplied(
    model,
    replied({ kind: "thread", id }, threadView({ id, entries: [], lastSeq: 0, changeSets: [set] })),
  )[0];
};

const tag = { kind: "secondLook", threadId: id, changeSetId: setId } as const;

test("Second look asks once and says Looking… at once; Approve stays usable until the look shows", () => {
  const [looking, effects] = send(loaded(), { type: "secondLookClicked", changeSetId: setId });
  assert.deepEqual(urls(effects), [`/api/change-sets/${setId}/second-look`]);
  assert.deepEqual(looking.looking, { [setId]: null });
  assert.deepEqual(looking.busy, [], "the change set itself isn't busy");
  // A second press while the first is in flight asks nothing.
  assert.deepEqual(send(looking, { type: "secondLookClicked", changeSetId: setId })[1], []);
  // Approve goes ahead meanwhile.
  const [, approving] = send(looking, {
    type: "changeSetClicked",
    changeSetId: setId,
    step: "approve",
  });
  assert.deepEqual(urls(approving), [`/api/change-sets/${setId}/approve`]);
});

test("answered, it says Looking… until the thread shows the look; refused, it recovers and says why", () => {
  const [looking] = send(loaded(), { type: "secondLookClicked", changeSetId: setId });
  // The answer asks for the thread at once, rather than wait on the stream,
  // whose change reads the diff first.
  const [answered, reload] = threadReplied(looking, replied(tag, { changeSet: openSet }));
  assert.deepEqual(answered.looking, { [setId]: null });
  assert.deepEqual(urls(reload), [`/api/threads/${id}`]);
  // A reload from before the look started still waits.
  assert.deepEqual(reloaded(answered, null).looking, { [setId]: null });
  assert.deepEqual(reloaded(answered, look()).looking, {});
  const [refused, again] = threadReplied(
    looking,
    replied(tag, { error: "second looks are off here" }, false),
  );
  assert.deepEqual(refused.looking, {});
  assert.equal(refused.problems[setId], "second looks are off here");
  assert.deepEqual(urls(again), [`/api/threads/${id}`]);
});

test("Look again waits for a look other than the stale one", () => {
  const stale = look({ state: "ready", stale: { diff: true, items: [] } });
  const [looking] = send(reloaded(loaded(), stale), {
    type: "secondLookClicked",
    changeSetId: setId,
  });
  assert.deepEqual(looking.looking, { [setId]: { id: stale.id, dismissed: false } });
  assert.deepEqual(reloaded(looking, stale).looking, {
    [setId]: { id: stale.id, dismissed: false },
  });
  const next = look({ id: "01JBZ0000000000000000000K2" });
  assert.deepEqual(reloaded(looking, next).looking, {});
  // Decided meanwhile, it can have no look: it stops waiting.
  assert.deepEqual(reloaded(looking).looking, {});
});

test("Dismiss hides the look at once and gives back Approve and Reject; refused, it shows again", () => {
  const shown = reloaded(loaded(), look({ state: "ready" }));
  const set = () => shown.view?.changeSets[0];
  assert.equal(shownLook(shown, set() ?? openSet)?.id, look().id);
  const [dismissed, effects] = send(shown, {
    type: "lookDismissed",
    changeSetId: setId,
    look: look().id,
  });
  assert.deepEqual(urls(effects), [`/api/change-sets/${setId}/second-look/dismiss`]);
  assert.equal(shownLook(dismissed, set() ?? openSet), null);
  // Twice is once.
  assert.deepEqual(
    send(dismissed, { type: "lookDismissed", changeSetId: setId, look: look().id })[1],
    [],
  );
  const [refused] = threadReplied(
    dismissed,
    replied(
      { kind: "lookDismissed", threadId: id, changeSetId: setId, look: look().id },
      { error: "no such second look on this change set" },
      false,
    ),
  );
  assert.equal(shownLook(refused, set() ?? openSet)?.id, look().id);
  assert.equal(refused.problems[setId], "no such second look on this change set");
});

test("a look dismissed while current shows again from Second look, which waits until it does", () => {
  const hidden = look({ state: "ready", dismissed: true });
  const model = reloaded(loaded(), hidden);
  assert.equal(shownLook(model, model.view?.changeSets[0] ?? openSet), null);
  const [looking] = send(model, { type: "secondLookClicked", changeSetId: setId });
  assert.deepEqual(looking.looking, { [setId]: { id: hidden.id, dismissed: true } });
  assert.deepEqual(reloaded(looking, hidden).looking, {
    [setId]: { id: hidden.id, dismissed: true },
  });
  const back = reloaded(looking, { ...hidden, dismissed: false });
  assert.deepEqual(back.looking, {});
  assert.equal(shownLook(back, back.view?.changeSets[0] ?? openSet)?.id, hidden.id);
});

test("its suggestions are added in one request, one or all", () => {
  const [, effects] = send(loaded(), {
    type: "suggestionAdded",
    changeSetId: setId,
    look: look().id,
    places: [0, 2],
  });
  const [effect] = effects;
  assert.ok(effect?.type === "http");
  assert.equal(effect.url, `/api/change-sets/${setId}/suggestions`);
  assert.deepEqual(effect.body, { look: look().id, places: [0, 2] });
});

test("a change to a look alone reloads the thread, and doesn't read the diff again", () => {
  const model = loaded();
  const [, lookOnly] = streamed(model, {
    type: "change-set",
    changeSetId: setId,
    applying: false,
    look: true,
  });
  assert.deepEqual(urls(lookOnly), [`/api/threads/${id}`]);
  const [, edited] = streamed(model, { type: "change-set", changeSetId: setId, applying: false });
  assert.deepEqual(urls(edited), [`/api/change-sets/${setId}/diff`]);
});
