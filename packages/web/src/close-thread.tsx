// Closing a thread from a list of threads: its row's context menu, and the
// one question deleting asks first.
import type { ComponentChildren } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import { type ClosingModel, type ClosingMsg, deletionWarning } from "./closing.ts";
import { type CloseVia } from "./closing.ts";
import { ContextMenu, type MenuItem } from "./menu.tsx";
import { Swipeable } from "./swipe.tsx";
import { ConnectorsContext, type Dispatch } from "./parts.tsx";
import type { UndoProblem } from "./undos.ts";
import type { ThreadSummaryView } from "./view.ts";

// A thread's row with its menu: Mark done, unless it is done, and Delete.
// With `swipe`, a swipe left shows the same actions, in that order. `moves`
// head the menu, not the swipe.
export function ThreadMenu(props: {
  thread: ThreadSummaryView;
  dispatch: Dispatch;
  swipe?: boolean;
  moves?: MenuItem[];
  class?: string;
  children: ComponentChildren;
}) {
  const { thread, dispatch } = props;
  const send = (msg: ClosingMsg) => dispatch({ type: "closing", msg });
  const title = thread.title ?? "New thread";
  const items = (via: CloseVia): MenuItem[] => [
    ...(thread.state === "done"
      ? []
      : [
          {
            label: "Mark done",
            onSelect: () => send({ type: "markDoneClicked", threadId: thread.id, via }),
          },
        ]),
    {
      label: "Delete…",
      danger: true,
      onSelect: () => send({ type: "deleteClicked", threadId: thread.id, title, via }),
    },
  ];
  return (
    <ContextMenu
      label={`Actions for ${title}`}
      items={[...(props.moves ?? []), ...items("menu")]}
      class={props.class}
    >
      {props.swipe ? (
        <Swipeable actions={items("swipe")}>{props.children}</Swipeable>
      ) : (
        props.children
      )}
    </ContextMenu>
  );
}

// Asks once before a delete, saying what it would lose.
export function Closing({ model, dispatch }: { model: ClosingModel; dispatch: Dispatch }) {
  const send = (msg: ClosingMsg) => dispatch({ type: "closing", msg });
  const connectors = useContext(ConnectorsContext);
  const { asking } = model;
  const asked = asking !== null;
  const pending = asking !== null && model.pending.includes(asking.threadId);
  return (
    <>
      <Confirm
        open={asked}
        id="confirm"
        title={asking && <>Delete “{asking.title}”?</>}
        body={
          asking?.deletion
            ? deletionWarning(asking.deletion, connectors)
            : "Checking what it changed…"
        }
        problem={model.problem}
        ready={asking?.deletion != null}
        pending={pending}
        onConfirm={() => send({ type: "deleteConfirmed" })}
        onCancel={() => send({ type: "deleteCancelled" })}
      />
    </>
  );
}

// A close from a list that failed, said in the bead until dismissed; while
// the question is open, it says it there instead.
export function closingProblem(model: ClosingModel, dispatch: Dispatch): UndoProblem | null {
  if (model.asking !== null || model.problem === null) return null;
  return {
    said: model.problem,
    onDismiss: () => dispatch({ type: "closing", msg: { type: "problemDismissed" } }),
  };
}

// The one question a delete asks first, as a modal the keyboard can answer:
// Cancel has focus, Enter deletes, and Escape cancels, closing nothing
// behind it, such as the drawer. `ready`: the person has been told what it
// would lose.
export function Confirm(props: {
  open: boolean;
  id: string;
  title: ComponentChildren;
  body: ComponentChildren;
  problem: string | null;
  ready: boolean;
  pending: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { open, id } = props;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      class="confirm"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onConfirm();
          }}
        >
          <h2 id={`${id}-title`} class="confirm-title">
            {props.title}
          </h2>
          <p id={`${id}-body`} class="confirm-body">
            {props.body}
          </p>
          {props.problem && (
            <p class="confirm-problem" role="alert">
              {props.problem}
            </p>
          )}
          <div class="confirm-actions">
            <button type="button" class="button" autoFocus onClick={props.onCancel}>
              Cancel
            </button>
            <button type="submit" class="button danger" disabled={!props.ready || props.pending}>
              {props.pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
