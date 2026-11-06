// A person's own edit of a stand-in's item in its panel (decision 0059): its
// form, which saves through Oriel's action for it (`item.edit`) and applies
// at once, and its Undo, one more note in the window's stack, as the panel's
// adds have (panel-adds.ts). Only an item whose read gives a form has one.
import { type Effect, errorOf, post, type Replied, undoing } from "./http.ts";
import { expiry, type Held, type Hold, hold, holding, notHeld, type Undos } from "./undos.ts";
import type { PanelEdit, PanelEditField, UndoView } from "./view.ts";

// The form open on an item: each field's text as typed, by its name.
export type EditForm = {
  item: string;
  fields: readonly PanelEditField[];
  typed: Readonly<Record<string, string>>;
  saving: boolean;
  problem: string | null;
};

// One saved edit: the item's key as a person reads it, for the stack's note;
// the call that undoes it; whether its Undo still shows, and its countdown.
export type SavedEdit = {
  item: string;
  key: string;
  pending: "undo" | null;
  undo: UndoView;
  shown: boolean;
  countdown: number;
  problem: string | null;
};

export type PanelEdits = {
  form: EditForm | null;
  saved: readonly SavedEdit[];
  held: Held;
  countdowns: number;
};

export const noEdits: PanelEdits = { form: null, saved: [], held: notHeld, countdowns: 0 };

export type PanelEditMsg =
  | { type: "editClicked"; item: string; edit: PanelEdit }
  | { type: "fieldTyped"; name: string; text: string }
  | { type: "cancelClicked" }
  | { type: "saveClicked"; key: string }
  | { type: "undoClicked"; item: string }
  | { type: "undoExpired"; item: string; countdown: number }
  | { type: "problemDismissed"; item: string };

// A field's value as its input shows it.
export function textOf(field: PanelEditField): string {
  switch (field.kind) {
    case "number":
      return field.value === null ? "" : String(field.value);
    case "person":
      return field.value ?? "";
    case "list":
      return field.value.join(", ");
    default:
      return field.value;
  }
}

// What the typed text sets each field to, of those that changed, or why it
// can't: a number that isn't one.
export function valuesOf(
  form: EditForm,
): { ok: true; values: Record<string, unknown> } | { ok: false; problem: string } {
  const values: Record<string, unknown> = {};
  for (const field of form.fields) {
    const typed = (form.typed[field.name] ?? textOf(field)).trim();
    if (typed === textOf(field).trim()) continue;
    switch (field.kind) {
      case "number": {
        const number = typed === "" ? null : Number(typed);
        if (number !== null && !Number.isFinite(number))
          return { ok: false, problem: `${field.label} must be a number.` };
        values[field.name] = number;
        break;
      }
      case "person":
        values[field.name] = typed === "" ? null : typed;
        break;
      case "list":
        values[field.name] = [
          ...new Set(
            typed
              .split(",")
              .map((each) => each.trim())
              .filter(Boolean),
          ),
        ];
        break;
      default:
        values[field.name] = field.kind === "text" ? (form.typed[field.name] ?? "") : typed;
    }
  }
  return { ok: true, values };
}

const put = (edits: PanelEdits, saved: SavedEdit): PanelEdits => ({
  ...edits,
  saved: [...edits.saved.filter((each) => each.item !== saved.item), saved],
});
const savedOf = (edits: PanelEdits, item: string) =>
  edits.saved.find((each) => each.item === item) ?? null;

export function updateEdits(edits: PanelEdits, msg: PanelEditMsg): [PanelEdits, Effect[]] {
  switch (msg.type) {
    case "editClicked":
      return [
        {
          ...edits,
          form: {
            item: msg.item,
            fields: msg.edit.fields,
            typed: {},
            saving: false,
            problem: null,
          },
        },
        [],
      ];
    case "fieldTyped": {
      const { form } = edits;
      if (!form || form.saving) return [edits, []];
      return [{ ...edits, form: { ...form, typed: { ...form.typed, [msg.name]: msg.text } } }, []];
    }
    case "cancelClicked":
      return [{ ...edits, form: edits.form?.saving ? edits.form : null }, []];
    case "saveClicked": {
      const { form } = edits;
      if (!form || form.saving) return [edits, []];
      const read = valuesOf(form);
      if (!read.ok) return [{ ...edits, form: { ...form, problem: read.problem } }, []];
      const { values } = read;
      if (Object.keys(values).length === 0) return [{ ...edits, form: null }, []];
      return [
        { ...edits, form: { ...form, saving: true, problem: null } },
        [
          post(
            "/api/actions/item.edit",
            { item: form.item, values },
            { kind: "panelEdited", id: form.item, key: msg.key },
          ),
        ],
      ];
    }
    // Through the one path every Undo takes.
    case "undoClicked": {
      const saved = savedOf(edits, msg.item);
      if (!saved || saved.pending || !saved.shown) return [edits, []];
      return [
        put(edits, { ...saved, pending: "undo", problem: null }),
        [undoing(saved.undo, { kind: "panelEditUndone", id: saved.item })],
      ];
    }
    case "undoExpired": {
      const saved = savedOf(edits, msg.item);
      if (!saved || saved.countdown !== msg.countdown || saved.pending || holding(edits.held))
        return [edits, []];
      return [put(edits, { ...saved, shown: false }), []];
    }
    case "problemDismissed": {
      const saved = savedOf(edits, msg.item);
      return saved ? [put(edits, { ...saved, problem: null }), []] : [edits, []];
    }
  }
}

// Its Undo's full time, from now, on a countdown no other has had.
function counted(edits: PanelEdits, saved: SavedEdit): [PanelEdits, Effect[]] {
  const countdown = edits.countdowns + 1;
  const next = { ...saved, countdown };
  const ends = expiry({
    type: "panelEdit",
    msg: { type: "undoExpired", item: next.item, countdown },
  });
  return [put({ ...edits, countdowns: countdown }, next), next.shown ? [ends] : []];
}

export function holdEdits(edits: PanelEdits, by: Hold, held: boolean): [PanelEdits, Effect[]] {
  return hold(edits, by, held, (base) =>
    base.saved
      .filter((saved) => saved.shown && !saved.pending)
      .reduce<[PanelEdits, Effect[]]>(
        ([now, effects], saved) => {
          const [next, more] = counted(now, saved);
          return [next, [...effects, ...more]];
        },
        [base, []],
      ),
  );
}

// The answer to a save or its Undo: a save closes the form and shows its
// Undo, running out; a refusal says why in the form. An Undo that landed
// takes its note away; one refused stays to try again, with its full time.
// `reread`: the item to read again, as its source changed.
export function editsReplied(
  edits: PanelEdits,
  msg: Replied,
): [PanelEdits, Effect[], string | null] {
  const { tag } = msg;
  if (tag.kind === "panelEdited") {
    const { form } = edits;
    if (!form || form.item !== tag.id || !form.saving) return [edits, [], null];
    if (!msg.ok)
      return [{ ...edits, form: { ...form, saving: false, problem: errorOf(msg.body) } }, [], null];
    const { undo } = msg.body as { undo: UndoView | null };
    const closed = { ...edits, form: null };
    if (undo === null) return [closed, [], tag.id];
    const [next, effects] = counted(closed, {
      item: tag.id,
      key: tag.key,
      pending: null,
      undo,
      shown: true,
      countdown: 0,
      problem: null,
    });
    return [next, effects, tag.id];
  }
  if (tag.kind === "panelEditUndone") {
    const saved = savedOf(edits, tag.id);
    if (saved?.pending !== "undo") return [edits, [], null];
    if (msg.ok)
      return [{ ...edits, saved: edits.saved.filter((each) => each !== saved) }, [], tag.id];
    const [next, effects] = counted(edits, {
      ...saved,
      pending: null,
      problem: errorOf(msg.body),
    });
    return [next, effects, null];
  }
  return [edits, [], null];
}

// Leaving a page: every Undo goes, as every note's does; an open form stays.
export const editsLeft = (edits: PanelEdits): PanelEdits => ({
  ...edits,
  saved: edits.saved.map((saved) =>
    saved.pending ? saved : { ...saved, shown: false, problem: null },
  ),
  held: notHeld,
});

// Each saved edit's Undo, as a note in the window's stack, and the last
// Undo that failed.
export function editUndos(edits: PanelEdits, send: (msg: PanelEditMsg) => void): Undos {
  const notes = edits.saved
    .filter((saved) => saved.shown)
    .map((saved) => {
      const said = `Edited ${saved.key}.`;
      return {
        key: `edited-${saved.item}`,
        said,
        label: `Undo: ${said}`,
        onUndo: () => send({ type: "undoClicked", item: saved.item }),
        disabled: saved.pending !== null,
      };
    });
  const failed = edits.saved.findLast((saved) => saved.problem !== null);
  const problem = failed && {
    said: `Couldn't undo editing ${failed.key}: ${failed.problem}`,
    onDismiss: () => send({ type: "problemDismissed", item: failed.item }),
  };
  return { notes, problem: problem ?? null };
}
