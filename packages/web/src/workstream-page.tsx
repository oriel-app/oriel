// A workstream: ask about it, see its threads, and curate its items.
import { useEffect, useRef } from "preact/hooks";
import { ThreadMenu } from "./close-thread.tsx";
import { EndButtons, WindowUndos } from "./end-workstream.tsx";
import { deleted, type EndingModel } from "./ending.ts";
import {
  askPrompt,
  type WorkstreamModel,
  type WorkstreamMsg,
  type Removal,
  undoable,
} from "./workstream.ts";
import {
  type Dispatch,
  DropZone,
  ItemListContext,
  Link,
  plural,
  StateChip,
  when,
} from "./parts.tsx";
import { Member } from "./thread-page.tsx";
import type { UndoNote, Undos } from "./undos.ts";
import type {
  WorkstreamChangeView,
  WorkstreamSummary,
  WorkstreamView,
  ThreadStateId,
  ThreadSummaryView,
} from "./view.ts";

// `threads`: the workstream's, from the list the sidebar keeps, so they move as
// it does. `ending`: what was last done to any workstream, or failed, and
// `added`, the panel's adds, which this page shows among its own Undos, in
// the one stack.
export function WorkstreamPage(props: {
  model: WorkstreamModel;
  threads: ThreadSummaryView[];
  ending: EndingModel;
  added: Undos;
  dispatch: Dispatch;
}) {
  const { model, threads, ending, dispatch } = props;
  const send = (msg: WorkstreamMsg) => dispatch({ type: "workstream", msg });
  const { view } = model;
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The item an undo brings back: its × takes focus once it shows again.
  const back = useRef<string | null>(null);
  const undo = (removal: Removal) => {
    back.current = removal.member.ref.id;
    send({ type: "undoClicked", version: removal.version });
  };
  useEffect(() => {
    const id = back.current;
    const row = id && rowOf(list.current, id);
    if (!row) return;
    back.current = null;
    row.querySelector<HTMLButtonElement>(".remove-member")?.focus();
  }, [view]);
  // A row's × that had focus hands it to the row below, or else above, so
  // the keyboard stays in the list as rows go.
  const remove = (id: string) => {
    const row = rowOf(list.current, id);
    if (row?.contains(document.activeElement)) {
      const beside = [row.nextElementSibling, row.previousElementSibling]
        .map((each) => each?.querySelector<HTMLButtonElement>(".remove-member"))
        .find((each) => each);
      (beside ?? addButton.current)?.focus();
    }
    send({ type: "memberRemoved", id });
  };
  const stack = (
    <WindowUndos
      ending={ending}
      more={{ ...props.added, notes: [...removed(model.removals, undo), ...props.added.notes] }}
      dispatch={dispatch}
    />
  );
  // Deleted, or being deleted, the page holds only what went, and its Undo.
  if (deleted(ending, model.id)) {
    const gone = ending.ended?.workstreamId === model.id ? ending.ended : null;
    return (
      <main class="page workstream-page">
        <h1 class="page-title">{view?.workstream.name ?? gone?.name}</h1>
        <p class="rail-empty">
          {gone
            ? "Deleted. Nothing lists it or its threads now, and its items stay in their sources."
            : "Deleting…"}
        </p>
        <WindowUndos ending={ending} more={props.added} dispatch={dispatch} />
      </main>
    );
  }
  if (view === null)
    return (
      <main class="page">
        {model.status === "failed" ? (
          <p class="failed" role="alert">
            This workstream didn't load.
          </p>
        ) : (
          <p class="loading">Loading…</p>
        )}
        {stack}
      </main>
    );
  const { workstream } = view;
  const members = view.members.filter(
    (member) => !model.removing.some((each) => each.id === member.ref.id),
  );
  return (
    <DropZone
      class="drop-page"
      label={`Drop to add to ${workstream.name}`}
      onDrop={(dropped) => send({ type: "dropped", dropped })}
    >
      <main class="page workstream-page">
        <header class="workstream-head">
          <div class="workstream-title-row">
            <input
              class="workstream-title"
              value={model.name ?? workstream.name}
              aria-label="Workstream name"
              maxLength={120}
              onInput={(event) => send({ type: "nameEdited", name: event.currentTarget.value })}
              onBlur={() => send({ type: "nameSaved" })}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <EndButtons
              workstream={workstream}
              done={workstream.done !== null}
              busy={ending.pending !== null}
              dispatch={dispatch}
            />
          </div>
          <p class="workstream-origin">
            {workstream.origin.kind === "cluster"
              ? `Copied from a cluster in the ${workstream.origin.grouping} grouping`
              : workstream.origin.kind === "thread"
                ? "Made by a thread started from nothing"
                : "Picked by hand"}
            {" · "}
            {plural(workstream.size, "item")} · v{workstream.version}
          </p>
          {workstream.done && (
            <p class="workstream-done">
              <StateChip state="done" waitingOn={null} /> Marked done {when(workstream.done.at)}
              {doneBy[workstream.done.by]}
            </p>
          )}
        </header>

        <form
          class="composer ask"
          onSubmit={(event) => {
            event.preventDefault();
            send({ type: "askClicked" });
          }}
        >
          <textarea
            rows={2}
            value={model.draft}
            placeholder={askPrompt(workstream.size)}
            aria-label="Ask about this workstream"
            onInput={(event) => send({ type: "draftChanged", text: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                send({ type: "askClicked" });
              }
            }}
          />
          <button
            type="submit"
            class="button primary"
            disabled={model.pending || model.draft.trim() === ""}
          >
            Ask
          </button>
        </form>
        {model.notice && (
          <p class="notice" data-tone="error" role="alert">
            {model.notice}
          </p>
        )}

        {threads.length > 0 && (
          <section class="section">
            <h2 class="section-title">Threads</h2>
            <Threads threads={threads} dispatch={dispatch} showWorkstream={false} said={null} />
          </section>
        )}

        <section class="section">
          <div class="section-head">
            <h2 class="section-title">Items</h2>
            <button
              type="button"
              class="quiet-action"
              ref={addButton}
              onClick={() => send({ type: "addClicked" })}
            >
              Add from the window
            </button>
          </div>
          {members.length === 0 ? (
            <p class="rail-empty">No items. Add some from the window.</p>
          ) : (
            <ItemListContext.Provider value={members.map((member) => member.ref.id)}>
              <ul class="members" ref={list}>
                {members.map((member) => (
                  <Member
                    key={member.ref.id}
                    member={member}
                    onRemove={() => remove(member.ref.id)}
                  />
                ))}
              </ul>
            </ItemListContext.Provider>
          )}
          {/* After the list, so the keyboard reaches them from the last row. */}
          {stack}
        </section>

        <History view={view} dispatch={dispatch} />
      </main>
    </DropZone>
  );
}

// Who marked it done, when it wasn't the user.
const doneBy: Record<NonNullable<WorkstreamSummary["done"]>["by"], string> = {
  user: "",
  agent: " by the agent",
  tool: " by an outside tool",
  other: "",
};

const rowOf = (list: HTMLUListElement | null, id: string) =>
  list?.querySelector(`[data-item="${CSS.escape(id)}"]`) ?? null;

// "Removed OA-12 · Undo", one for each removal that can still be undone.
const removed = (removals: readonly Removal[], onUndo: (removal: Removal) => void): UndoNote[] =>
  removals.map((removal) => {
    const { key } = removal.member.ref;
    return {
      key: `removed-${removal.version}`,
      said: `Removed ${key}`,
      label: `Undo removing ${key}`,
      onUndo: undoable(removal) ? () => onUndo(removal) : null,
      cannot: "It's no longer in the window, so it can't come back.",
    };
  });

// Who changed a workstream, when it wasn't the user.
const causes: Record<WorkstreamChangeView["cause"], string> = {
  user: "",
  agent: " · by the agent",
  tool: " · by an outside tool",
  "review-link": " · from a review link",
  "change-set": " · by an applied change set",
  sync: " · by a sync",
};

// The workstream's versions, newest first, folded. What an agent did names
// the thread it did it in.
function History({ view, dispatch }: { view: WorkstreamView; dispatch: Dispatch }) {
  return (
    <details class="history">
      <summary>{plural(view.changes.length, "version")}</summary>
      <ol class="changes">
        {view.changes.map((change) => (
          <li key={change.version}>
            <span class="change-version">v{change.version}</span>
            <span>
              {change.version === 1
                ? `Made with ${plural(change.added.length, "item")}`
                : [
                    change.added.length ? `Added ${change.added.map((r) => r.key).join(", ")}` : "",
                    change.removed.length
                      ? `Removed ${change.removed.map((r) => r.key).join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
              {change.thread ? (
                <>
                  {causes.agent} in{" "}
                  <Link route={{ page: "thread", id: change.thread.id }} dispatch={dispatch}>
                    {change.thread.title ?? "a thread"}
                  </Link>
                </>
              ) : (
                causes[change.cause]
              )}
            </span>
            <span class="change-at">{when(change.at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// `said`: the state the list itself says, as a Done page tab does, which a
// row then names only when it waits on something.
export function Threads(props: {
  threads: ThreadSummaryView[];
  dispatch: Dispatch;
  showWorkstream: boolean;
  said: ThreadStateId | null;
}) {
  return (
    <ul class="thread-list">
      {props.threads.map((thread) => (
        <li key={thread.id}>
          <ThreadMenu thread={thread} dispatch={props.dispatch}>
            <Link
              route={{ page: "thread", id: thread.id }}
              dispatch={props.dispatch}
              class="thread-link"
            >
              <span class="thread-link-title">{thread.title ?? "New thread"}</span>
              {props.showWorkstream && (
                <span class="thread-link-workstream">{thread.workstream.name}</span>
              )}
              {(thread.waitingOn || thread.state !== props.said) && (
                <StateChip state={thread.state} waitingOn={thread.waitingOn} />
              )}
              <span class="thread-link-at">{when(thread.activityAt)}</span>
            </Link>
          </ThreadMenu>
        </li>
      ))}
    </ul>
  );
}
