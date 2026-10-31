// Closing a thread from a list of threads: its row's context menu, and the
// one question deleting asks first.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { type ClosingModel, type ClosingMsg, deletionWarning } from "./closing.ts";
import { ContextMenu, type MenuItem } from "./menu.tsx";
import type { Dispatch } from "./parts.tsx";
import type { ThreadSummaryView } from "./view.ts";

// A thread's row with its menu: Mark done, unless it is done, and Delete.
export function ThreadMenu(props: {
  thread: ThreadSummaryView;
  dispatch: Dispatch;
  class?: string;
  children: ComponentChildren;
}) {
  const { thread, dispatch } = props;
  const send = (msg: ClosingMsg) => dispatch({ type: "closing", msg });
  const title = thread.title ?? "New thread";
  const items: MenuItem[] = [
    ...(thread.state === "done"
      ? []
      : [
          {
            label: "Mark done",
            onSelect: () => send({ type: "markDoneClicked", threadId: thread.id, via: "menu" }),
          },
        ]),
    {
      label: "Delete…",
      danger: true,
      onSelect: () => send({ type: "deleteClicked", threadId: thread.id, title, via: "menu" }),
    },
  ];
  return (
    <ContextMenu label={`Actions for ${title}`} items={items} class={props.class}>
      {props.children}
    </ContextMenu>
  );
}

// Asks once before a delete, saying what it would lose; and says when a
// close failed.
export function Closing({ model, dispatch }: { model: ClosingModel; dispatch: Dispatch }) {
  const send = (msg: ClosingMsg) => dispatch({ type: "closing", msg });
  const dialog = useRef<HTMLDialogElement>(null);
  const { asking } = model;
  const asked = asking !== null;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asked && !element.open) element.showModal();
    if (!asked && element.open) element.close();
  }, [asked]);
  const pending = asking !== null && model.pending.includes(asking.threadId);
  return (
    <>
      <dialog
        ref={dialog}
        class="confirm"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        // Escape cancels here, and closes nothing behind, such as the drawer.
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        onCancel={(event) => {
          event.preventDefault();
          send({ type: "deleteCancelled" });
        }}
      >
        {asking && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send({ type: "deleteConfirmed" });
            }}
          >
            <h2 id="confirm-title" class="confirm-title">
              Delete “{asking.title}”?
            </h2>
            <p id="confirm-body" class="confirm-body">
              {asking.deletion ? deletionWarning(asking.deletion) : "Checking what it changed…"}
            </p>
            {model.problem && (
              <p class="confirm-problem" role="alert">
                {model.problem}
              </p>
            )}
            <div class="confirm-actions">
              <button
                type="button"
                class="button"
                autoFocus
                onClick={() => send({ type: "deleteCancelled" })}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="button danger"
                disabled={asking.deletion === null || pending}
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </form>
        )}
      </dialog>
      {!asked && model.problem && (
        <p class="closing-problem" role="alert">
          {model.problem}
          <button
            type="button"
            class="quiet-action"
            onClick={() => send({ type: "problemDismissed" })}
          >
            Dismiss
          </button>
        </p>
      )}
    </>
  );
}
