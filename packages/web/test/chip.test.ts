// A reply's link to a thread or a change set shows as a chip (OA-113): its
// kind, its name and where it stands, from the lists the window keeps. Links
// to items and the web stay links.
import assert from "node:assert/strict";
import { test } from "node:test";
import { changeSetLink, threadLink } from "@oriel/core/oriel-reads";
import { chipLabel, chipStateName, linkChip, type Workspace } from "../src/chip.ts";
import { type Inline, parse } from "../src/markdown.ts";
import { init, update } from "../src/root.ts";
import type { Route } from "../src/route.ts";
import type { ThreadsView } from "../src/view.ts";
import { threadSummary } from "../testing.ts";

const posted = "01JBZ0000000000000000000T1";
const asking = "01JBZ0000000000000000000T2";
const setId = "01JBZ0000000000000000000C1";

const workspace: Workspace = {
  threads: [
    threadSummary({ id: posted, title: "Try a Slack post", state: "done", doneBy: "applied" }),
    threadSummary({ id: asking, title: null, waitingOn: "reply" }),
  ],
  changeSets: [{ id: setId, thread: posted, state: "applied" }],
};

// The links in a reply, in order.
function links(text: string): Inline[] {
  const found: Inline[] = [];
  const walk = (inlines: readonly Inline[]) => {
    for (const each of inlines) {
      if (each.kind === "route" || each.kind === "link") found.push(each);
      if ("children" in each) walk(each.children);
    }
  };
  for (const block of parse(text)) if (block.kind === "paragraph") walk(block.children);
  return found;
}

const routeOf = (inline: Inline | undefined): Route => {
  assert.ok(inline?.kind === "route");
  return inline.route;
};

test("a reply's links to a thread and a change set are chips with their names and states", () => {
  const [thread, changeSet, web] = links(
    `It was in [that thread](${threadLink(posted)}), where you ` +
      `[approved it](${changeSetLink(posted, setId)}). See [the docs](https://example.com/a).`,
  );
  assert.deepEqual(linkChip(routeOf(thread), workspace), {
    kind: "thread",
    name: "Try a Slack post",
    state: "done",
  });
  // A change set goes by its thread's name.
  assert.deepEqual(linkChip(routeOf(changeSet), workspace), {
    kind: "change-set",
    name: "Try a Slack post",
    state: "applied",
  });
  // A link to the web stays a web link, which no chip replaces.
  assert.deepEqual(web, {
    kind: "link",
    href: "https://example.com/a",
    children: [{ kind: "text", text: "the docs" }],
  });
});

test("a working thread waiting on the user needs them; one without a title is a new thread", () => {
  assert.deepEqual(linkChip({ page: "thread", id: asking }, workspace), {
    kind: "thread",
    name: "New thread",
    state: "needs-you",
  });
  const busy: Workspace = {
    ...workspace,
    threads: [threadSummary({ id: asking, title: "Plan", waitingOn: "agent" })],
  };
  assert.deepEqual(linkChip({ page: "thread", id: asking }, busy), {
    kind: "thread",
    name: "Plan",
    state: "working",
  });
});

test("a link the window doesn't know keeps its kind, without a name or state", () => {
  const gone = "01JBZ0000000000000000000T9";
  assert.deepEqual(linkChip({ page: "thread", id: gone }, workspace), {
    kind: "thread",
    name: null,
    state: null,
  });
  // A change set named with another thread is not that change set.
  assert.deepEqual(linkChip({ page: "thread", id: asking, changeSet: setId }, workspace), {
    kind: "change-set",
    name: "New thread",
    state: null,
  });
  // Before the lists load.
  assert.deepEqual(
    linkChip({ page: "thread", id: posted, changeSet: setId }, { threads: null, changeSets: null }),
    { kind: "change-set", name: null, state: null },
  );
});

test("only a thread's page is a chip", () => {
  assert.equal(linkChip({ page: "workstream", id: posted }, workspace), null);
});

test("the window keeps where each change set stands beside its threads, as the list reloads", () => {
  const [start] = init({ page: "thread", id: asking });
  const body: ThreadsView = {
    threads: [threadSummary({ id: posted })],
    changeSets: [{ id: setId, thread: posted, state: "pending" }],
  };
  const [loaded] = update(start, { type: "replied", tag: { kind: "threads" }, ok: true, body });
  assert.deepEqual(loaded.changeSets, body.changeSets);
  const moved: ThreadsView = {
    ...body,
    changeSets: [{ id: setId, thread: posted, state: "applied" }],
  };
  const [after] = update(loaded, {
    type: "replied",
    tag: { kind: "threads" },
    ok: true,
    body: moved,
  });
  assert.deepEqual(after.changeSets, moved.changeSets);
  // A failed reload keeps what showed.
  const [kept] = update(after, {
    type: "replied",
    tag: { kind: "threads" },
    ok: false,
    body: null,
  });
  assert.deepEqual(kept.changeSets, moved.changeSets);
});

test("each state reads as a person says it, as the sidebar says it", () => {
  assert.deepEqual(
    (["needs-you", "handed-off", "working", "pending", "reverted"] as const).map(chipStateName),
    ["Needs you", "Handed off", "Working", "Waiting", "Reverted"],
  );
});

test("a chip tells a screen reader its kind, name and state, or leaves the label to say it", () => {
  assert.equal(
    chipLabel({ kind: "change-set", name: "Try a Slack post", state: "pending" }),
    "Change set: Try a Slack post, waiting",
  );
  assert.equal(chipLabel({ kind: "thread", name: "Plan", state: null }), "Thread: Plan");
  assert.equal(chipLabel({ kind: "thread", name: null, state: null }), undefined);
});
