import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import {
  editsReplied,
  editUndos,
  noEdits,
  type PanelEdits,
  updateEdits,
  valuesOf,
} from "../src/panel-edits.ts";
import type { PanelEdit } from "../src/view.ts";

const item = "tracker:T-2";
const edit: PanelEdit = {
  fields: [
    { name: "summary", label: "Summary", kind: "line", value: "Pricing" },
    { name: "status", label: "Status", kind: "choice", value: "To do", choices: ["To do", "Done"] },
    { name: "points", label: "Estimate", kind: "number", value: null, empty: "Not estimated yet" },
    { name: "assignee", label: "Assignee", kind: "person", value: "Ada", empty: "Unassigned" },
    { name: "labels", label: "Labels", kind: "list", value: ["web"] },
    { name: "description", label: "Description", kind: "text", value: "" },
  ],
};

const open = (): PanelEdits => updateEdits(noEdits, { type: "editClicked", item, edit })[0];
const typed = (edits: PanelEdits, name: string, text: string) =>
  updateEdits(edits, { type: "fieldTyped", name, text })[0];

test("a save sends only what changed, each as its field's kind takes it", () => {
  let edits = open();
  edits = typed(edits, "points", " 3 ");
  edits = typed(edits, "assignee", "");
  edits = typed(edits, "labels", "web, launch, web");
  edits = typed(edits, "summary", "Pricing");
  assert.ok(edits.form);
  assert.deepEqual(valuesOf(edits.form), {
    ok: true,
    values: { points: 3, assignee: null, labels: ["web", "launch"] },
  });
  const [saving, effects] = updateEdits(edits, { type: "saveClicked", key: "T-2" });
  assert.equal(saving.form?.saving, true);
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: "/api/actions/item.edit",
      body: { item, values: { points: 3, assignee: null, labels: ["web", "launch"] } },
      tag: { kind: "panelEdited", id: item, key: "T-2" },
    },
  ]);
});

test("a saved edit closes the form, reads the item again, and its Undo is a note in the stack", () => {
  const [saving] = updateEdits(typed(open(), "status", "Done"), {
    type: "saveClicked",
    key: "T-2",
  });
  const undo = { action: "item.edit", input: { item, values: { status: "To do" } } };
  const reply: Replied = {
    type: "replied",
    tag: { kind: "panelEdited", id: item, key: "T-2" },
    ok: true,
    body: { undo },
  };
  const [saved, effects, reread] = editsReplied(saving, reply);
  assert.equal(saved.form, null);
  assert.equal(reread, item);
  assert.equal(effects[0]?.type, "after");
  const sent: unknown[] = [];
  const notes = editUndos(saved, (msg) => sent.push(msg)).notes;
  assert.equal(notes.length, 1);
  notes[0]?.onUndo?.();
  assert.deepEqual(sent, [{ type: "undoClicked", item }]);
  const [undoing, undoEffects] = updateEdits(saved, { type: "undoClicked", item });
  assert.deepEqual(
    undoEffects.map((effect) => effect.type === "http" && effect.url),
    ["/api/actions/item.edit"],
  );
  const [undone, , again] = editsReplied(undoing, {
    type: "replied",
    tag: { kind: "panelEditUndone", id: item },
    ok: true,
    body: { undo: null },
  });
  assert.deepEqual([undone.saved, again], [[], item]);
});

test("a save the server refused keeps the form open with what was typed, and says why", () => {
  const [saving] = updateEdits(typed(open(), "summary", "x"), { type: "saveClicked", key: "T-2" });
  const [refused] = editsReplied(saving, {
    type: "replied",
    tag: { kind: "panelEdited", id: item, key: "T-2" },
    ok: false,
    body: { error: "summary: too long" },
  });
  assert.equal(refused.form?.saving, false);
  assert.equal(refused.form?.typed.summary, "x");
  assert.ok(refused.form?.problem);
});
