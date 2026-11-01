import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceKinds } from "@oriel/core";
import { sources } from "./index.ts";

test("every source has its own view of an item, and none of content it can't read", () => {
  for (const kind of sourceKinds) {
    assert.equal(sources[kind].panel({ title: "t", text: "x" }), null, kind);
    assert.equal(sources[kind].panel(null), null, kind);
  }
});

test("a Jira issue with no estimate, description or comments says so", () => {
  const view = sources.jira.panel({
    issueType: "Story",
    status: { name: "To Do", category: "todo" },
    moves: [],
    epic: null,
    assignee: null,
    points: null,
    labels: [],
    summary: "<b>Bold</b> & loud",
    description: "",
    comments: [],
    links: [],
    title: "<b>Bold</b> & loud",
    text: "",
  });
  assert.deepEqual(view, {
    title: null,
    blocks: [
      {
        kind: "facts",
        facts: [
          { name: "Type", value: "Story" },
          { name: "Status", value: "To Do" },
          { name: "Assignee", value: "Unassigned" },
          { name: "Estimate", value: "Not estimated yet" },
        ],
      },
      { kind: "text", heading: "Description", text: "No description.", format: "plain" },
      { kind: "messages", heading: "Comments", messages: [], empty: "No comments." },
    ],
  });
});

test("a Jira issue on a board that takes no estimates has no estimate to show", () => {
  const blocks = sources.jira.panel({
    issueType: "Task",
    status: { name: "To Do", category: "todo" },
    moves: [],
    epic: null,
    assignee: null,
    labels: [],
    summary: "Tidy",
    description: "",
    comments: [],
    links: [],
    title: "Tidy",
    text: "",
  });
  const first = blocks?.blocks[0];
  const facts = first?.kind === "facts" ? first.facts.map((fact) => fact.name) : [];
  assert.deepEqual(facts, ["Type", "Status", "Assignee"]);
});

test("a Slack message is named by its channel, with its replies under it, its text as written", () => {
  const body = "<script>alert(1)</script> & <@U1>";
  const view = sources.slack.panel({
    channel: { id: "C1", name: "weather" },
    author: { id: "U1", name: "Dara" },
    postedAt: "2026-09-20T10:00:00.000Z",
    editedAt: null,
    body,
    replies: [],
    title: "Dara: x",
    text: "x",
  });
  assert.deepEqual(view, {
    title: "#weather",
    blocks: [
      {
        kind: "messages",
        heading: null,
        messages: [{ author: "Dara", at: "2026-09-20T10:00:00.000Z", text: body }],
        empty: "No message.",
      },
      { kind: "messages", heading: "0 replies", messages: [], empty: "No replies yet." },
    ],
  });
});

test("a file too large to read is its note alone; one with replaced bytes has both", () => {
  const note = "This file is too large.";
  assert.deepEqual(sources.folder.panel({ title: "big", text: note, note }), {
    title: null,
    blocks: [{ kind: "note", text: note }],
  });
  const replaced = sources.folder.panel({ title: "odd", text: "a�b", note: "Replaced." });
  assert.deepEqual(replaced, {
    title: null,
    blocks: [
      { kind: "note", text: "Replaced." },
      { kind: "text", heading: null, text: "a�b", format: "markdown" },
    ],
  });
});
