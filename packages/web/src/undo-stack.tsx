// The one stack of Undo notes at the foot of the window (OA-142): what was
// done, each with its Undo or why it can't be undone, newest at the bottom,
// read out as each shows, and what last failed. None runs out while the
// pointer or focus is on them, and ⌘Z or Ctrl+Z undoes the one at the bottom.
// Every note's model hears one hold, through `onHold`: an Undo lets go of the
// keyboard's, and a stack that goes, as when a page swaps it for another,
// lets go of both, since no leave event comes.
import { useEffect, useRef } from "preact/hooks";
import { type Held, type Hold, latestNote, notHeld } from "./undos.ts";

export type UndoNote = {
  key: string;
  said: string;
  // The Undo as a screen reader names it.
  label: string;
  // Null when it can't be undone, which `cannot` then says, if anything.
  onUndo: (() => void) | null;
  cannot?: string;
  disabled?: boolean;
};

const shortcut =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Meta+Z" : "Control+Z";

export function UndoStack(props: {
  notes: readonly UndoNote[];
  problem?: { said: string; onDismiss(): void } | null;
  onHold(by: Hold, held: boolean): void;
}) {
  const { notes, problem } = props;
  // What holds the stack now, and the latest `onHold`, for letting go after
  // it has gone.
  const held = useRef<Held>(notHeld);
  const onHold = useRef(props.onHold);
  onHold.current = props.onHold;
  const hold = (by: Hold, on: boolean) => {
    if (held.current[by] === on) return;
    held.current = { ...held.current, [by]: on };
    onHold.current(by, on);
  };
  useEffect(
    () => () => {
      hold("pointer", false);
      hold("focus", false);
    },
    [],
  );
  const undo = (onUndo: () => void) => {
    hold("focus", false);
    onUndo();
  };
  const latest = latestNote(notes);
  const undoLatest = useRef<(() => void) | null>(null);
  const latestUndo = latest && !latest.disabled ? latest.onUndo : null;
  undoLatest.current = latestUndo && (() => undo(latestUndo));
  const armed = latest !== null;
  useEffect(() => {
    if (!armed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      // A text field undoes its own typing.
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea"))
      )
        return;
      event.preventDefault();
      undoLatest.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed]);
  return (
    <div
      class="undos"
      role="status"
      onMouseEnter={() => hold("pointer", true)}
      onMouseLeave={() => hold("pointer", false)}
      onFocusIn={() => hold("focus", true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hold("focus", false);
      }}
    >
      {notes.map(({ onUndo, ...note }) => (
        <p class="undo" key={note.key}>
          <span>{note.said}</span>
          {onUndo ? (
            <button
              type="button"
              class="undo-action"
              disabled={note.disabled}
              aria-label={note.label}
              aria-keyshortcuts={note.key === latest?.key ? shortcut : undefined}
              onClick={() => undo(onUndo)}
            >
              Undo
            </button>
          ) : (
            note.cannot && <span class="undo-note">{note.cannot}</span>
          )}
        </p>
      ))}
      {problem && (
        <p class="undo" role="alert">
          <span>{problem.said}</span>
          <button type="button" class="undo-action" onClick={problem.onDismiss}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
