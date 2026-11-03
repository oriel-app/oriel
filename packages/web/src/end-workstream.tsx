// Ending a workstream (decision 0028): its page's header buttons, its menu
// and swipe in a list, and, once for the app, the question deleting asks and
// what was done, with its Undo, as a note in the one stack of Undos.
import type { ComponentChildren } from "preact";
import { Confirm } from "./close-thread.tsx";
import {
  deleteWarning,
  type Ended,
  endedText,
  type EndingModel,
  type EndingMsg,
} from "./ending.ts";
import { ContextMenu, type MenuItem } from "./menu.tsx";
import type { Dispatch } from "./parts.tsx";
import { Swipeable } from "./swipe.tsx";
import { holdUndos, UndoStack } from "./undo-stack.tsx";
import type { Undos } from "./undos.ts";
import { Tooltip } from "./tooltip.tsx";

const sender = (dispatch: Dispatch) => (msg: EndingMsg) => dispatch({ type: "ending", msg });

// Mark done, or Reopen once it is done, and Delete.
const endings = (workstream: Ended, done: boolean, send: (msg: EndingMsg) => void): MenuItem[] => [
  done
    ? { label: "Reopen", onSelect: () => send({ type: "reopenClicked", workstream }) }
    : { label: "Mark done", onSelect: () => send({ type: "markDoneClicked", workstream }) },
  { label: "Delete…", danger: true, onSelect: () => send({ type: "deleteClicked", workstream }) },
];

// A workstream's row with its menu, and with `swipe`, a swipe left that
// shows the same actions.
export function WorkstreamMenu(props: {
  workstream: Ended;
  done: boolean;
  dispatch: Dispatch;
  swipe?: boolean;
  class?: string;
  children: ComponentChildren;
}) {
  const items = endings(props.workstream, props.done, sender(props.dispatch));
  return (
    <ContextMenu label={`Actions for ${props.workstream.name}`} items={items} class={props.class}>
      {props.swipe ? <Swipeable actions={items}>{props.children}</Swipeable> : props.children}
    </ContextMenu>
  );
}

// The page header's icon buttons, beside the workstream's name.
export function EndButtons(props: {
  workstream: Ended;
  done: boolean;
  busy: boolean;
  dispatch: Dispatch;
}) {
  const send = sender(props.dispatch);
  const { workstream } = props;
  const [first, remove] = endings(workstream, props.done, send);
  return (
    <div class="workstream-actions">
      {first && (
        <Tooltip text={first.label}>
          <button
            type="button"
            class="head-action"
            aria-label={`${first.label}: ${workstream.name}`}
            disabled={props.busy}
            onClick={first.onSelect}
          >
            {props.done ? <ReopenIcon /> : <DoneIcon />}
          </button>
        </Tooltip>
      )}
      {remove && (
        <Tooltip text="Delete…">
          <button
            type="button"
            class="head-action"
            data-danger
            aria-label={`Delete ${workstream.name}…`}
            disabled={props.busy}
            onClick={remove.onSelect}
          >
            <TrashIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

// What was last done, with its Undo, and what last failed, as notes in the
// one stack of Undos: the page's, where it has one, or else the app's.
export function endingNotes(model: EndingModel, dispatch: Dispatch): Undos {
  const send = sender(dispatch);
  const { ended } = model;
  const said = ended && model.shown ? endedText(ended) : null;
  return {
    notes:
      ended && said
        ? [
            {
              key: `${ended.kind}-${ended.workstreamId}`,
              said,
              label: `Undo: ${said}`,
              onUndo: ended.undo ? () => send({ type: "undoClicked" }) : null,
              disabled: model.pending !== null,
            },
          ]
        : [],
    problem:
      model.problem && !model.asking
        ? { said: model.problem, onDismiss: () => send({ type: "problemDismissed" }) }
        : null,
  };
}

// The window's stack of Undo notes: what was last done to a workstream, or
// failed, with the page's own notes and the panel's adds (`more`), each
// where its order of showing puts it.
export function WindowUndos(props: { ending: EndingModel; more: Undos; dispatch: Dispatch }) {
  const ended = endingNotes(props.ending, props.dispatch);
  return (
    <UndoStack
      notes={[...ended.notes, ...props.more.notes]}
      problem={ended.problem ?? props.more.problem}
      onHold={holdUndos(props.dispatch)}
      dispatch={props.dispatch}
    />
  );
}

// Once for the app: deleting's question; and the window's Undo notes, what
// was done, or failed, and the panel's adds (`added`), unless the page on
// screen shows those among its own Undos (`shownByPage`).
export function Endings(props: {
  model: EndingModel;
  added: Undos;
  shownByPage: boolean;
  dispatch: Dispatch;
}) {
  const { model, dispatch } = props;
  const send = sender(dispatch);
  const { asking } = model;
  return (
    <>
      <Confirm
        open={asking !== null}
        id="delete-workstream"
        title={asking && <>Delete “{asking.name}”?</>}
        body={asking && deleteWarning(asking.threads)}
        problem={asking ? model.problem : null}
        ready
        pending={model.pending?.deleting === true}
        onConfirm={() => send({ type: "deleteConfirmed" })}
        onCancel={() => send({ type: "deleteCancelled" })}
      />
      {!props.shownByPage && <WindowUndos ending={model} more={props.added} dispatch={dispatch} />}
    </>
  );
}

function DoneIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
    </svg>
  );
}

function ReopenIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2" />
      <path d="M3.25 4.25v3.5h3.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75" />
    </svg>
  );
}
