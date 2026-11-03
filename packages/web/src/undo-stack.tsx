// The one stack of Undo notes at the foot of the window (OA-142): what was
// done, each with its Undo or why it can't be undone, in the order they
// showed, newest at the bottom, read out as each shows, and what last failed. None runs out while the
// pointer or focus is on them, and ⌘Z or Ctrl+Z undoes the one at the bottom.
// Every note's model hears one hold, through `onHold`: an Undo lets go of the
// keyboard's, and a stack that goes, as when a page swaps it for another,
// lets go of both, since no leave event comes.
import { useEffect, useRef } from "preact/hooks";
import type { Dispatch } from "./parts.tsx";
import {
  type Held,
  type Hold,
  inShowingOrder,
  latestNote,
  notHeld,
  type UndoNote,
  type UndoProblem,
} from "./undos.ts";

const shortcut =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Meta+Z" : "Control+Z";

// Every note's hold goes the one way, whichever stack is on screen.
export const holdUndos = (dispatch: Dispatch) => (by: Hold, held: boolean) =>
  dispatch({ type: "undoHeld", by, held });

export function UndoStack(props: {
  notes: readonly UndoNote[];
  problem?: UndoProblem | null;
  onHold(by: Hold, held: boolean): void;
}) {
  const { problem } = props;
  const shown = useRef<readonly string[]>([]);
  const notes = inShowingOrder(shown.current, props.notes);
  shown.current = notes.map((note) => note.key);
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
            <UndoButton
              label={note.label}
              disabled={note.disabled}
              keys={note.key === latest?.key}
              onClick={() => undo(onUndo)}
            />
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

// A note's Undo, in the stack or beside the change it undoes (decision
// 0024). `keys`: whether ⌘Z or Ctrl+Z presses it.
export function UndoButton(props: {
  label: string;
  disabled?: boolean;
  keys?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      class="undo-action"
      disabled={props.disabled}
      aria-label={props.label}
      aria-keyshortcuts={props.keys ? shortcut : undefined}
      onClick={props.onClick}
    >
      Undo
    </button>
  );
}
