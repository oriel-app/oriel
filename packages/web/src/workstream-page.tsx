// A workstream: ask about it, see its threads, and curate its items.
import { useEffect, useRef } from "preact/hooks";
import { ChatInput, LookingChips, readsWith } from "./chat-input.tsx";
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
  Member,
  Link,
  plural,
  StateChip,
  Stamp,
} from "./parts.tsx";
import type { UndoNote, Undos } from "./undos.ts";
import { addOf, type PanelAdds } from "./panel-adds.ts";
import type { MenuItem } from "./menu.tsx";
import type { Carried, MovingMsg } from "./moving.ts";
import type {
  MemberView,
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
  // Every workstream, for the open ones an item can move to.
  workstreams: WorkstreamSummary[] | null;
  threads: ThreadSummaryView[];
  ending: EndingModel;
  added: Undos;
  // Every add from the panel, or from a suggestion here, in flight or done.
  adds: PanelAdds;
  dispatch: Dispatch;
}) {
  const { model, threads, ending, dispatch } = props;
  const send = (msg: WorkstreamMsg) => dispatch({ type: "workstream", msg });
  const { view } = model;
  const list = useRef<HTMLUListElement>(null);
  const suggestions = useRef<HTMLUListElement>(null);
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
  // A row's button that had focus hands it to the same one on the row
  // below, or else above, so the keyboard stays in the list as rows go.
  const handOn = (rows: HTMLUListElement | null, id: string, button: string) => {
    const row = rowOf(rows, id);
    if (!row?.contains(document.activeElement)) return;
    const beside = [row.nextElementSibling, row.previousElementSibling]
      .map((each) => each?.querySelector<HTMLButtonElement>(button))
      .find((each) => each);
    (beside ?? addButton.current)?.focus();
  };
  const remove = (id: string) => {
    handOn(list.current, id, ".remove-member");
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
  // A suggestion goes once it's added, or on its way in.
  const suggested = model.suggested.filter((each) => {
    const add = addOf(props.adds, { item: each.ref.id, workstreamId: workstream.id });
    const going = add?.pending === "add" || add?.done != null;
    return !going && !members.some((member) => member.ref.id === each.ref.id);
  });
  // An add from here the server refused, which the panel may not be open to
  // say: its row stays, to try again.
  const refused = suggested.flatMap((each) => {
    const problem = addOf(props.adds, { item: each.ref.id, workstreamId: workstream.id })?.problem;
    return problem ? [`Couldn't add ${each.ref.key}: ${problem}`] : [];
  });
  // Through the panel's add, so its Undo is one more note in the stack.
  const add = (member: MemberView) => {
    handOn(suggestions.current, member.ref.id, ".add-member");
    dispatch({
      type: "panelAdd",
      msg: {
        type: "addClicked",
        item: { id: member.ref.id, key: member.ref.key },
        workstream: { id: workstream.id, name: workstream.name },
      },
    });
  };
  // An item open beside the Ask box that the workstream doesn't hold is
  // read-only to the thread it starts, which Cite adds it to (decision 0062).
  const readOnly = (id: string) => !members.some((member) => member.ref.id === id);
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
                : workstream.origin.kind === "window"
                  ? "Made by a question in the window chat"
                  : "Picked by hand"}
            {" · "}
            {plural(workstream.size, "item")} · v{workstream.version}
          </p>
          {workstream.done && (
            <p class="workstream-done">
              <StateChip state="done" waitingOn={null} /> Marked done{" "}
              <Stamp at={workstream.done.at} />
              {doneBy[workstream.done.by]}
            </p>
          )}
        </header>

        <ChatInput
          class="workstream-ask"
          label="Ask about this workstream"
          submitLabel="Ask"
          draft={model.draft}
          busy={model.pending}
          notice={model.notice}
          placeholder={askPrompt(workstream.size)}
          reads={readsWith(
            `Reads ${plural(workstream.size, "item")} · v${workstream.version}`,
            model.lookingAt,
            readOnly,
          )}
          context={
            <LookingChips
              lookingAt={model.lookingAt}
              readOnly={readOnly}
              onLooking={(msg) => send({ type: "looking", msg })}
              onCite={(item) =>
                dispatch({
                  type: "panelAdd",
                  msg: {
                    type: "addClicked",
                    item: { id: item.id, key: item.key },
                    workstream: { id: workstream.id, name: workstream.name },
                  },
                })
              }
            />
          }
          onDraft={(text) => send({ type: "draftChanged", text })}
          onSubmit={() => send({ type: "askClicked" })}
        />

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
            suggested.length === 0 && <p class="rail-empty">No items.</p>
          ) : (
            <ItemListContext.Provider value={members.map((member) => member.ref.id)}>
              <ul class="members" ref={list}>
                {members.map((member) => (
                  <Member
                    key={member.ref.id}
                    member={member}
                    onRemove={() => remove(member.ref.id)}
                    moving={movingOf(member, workstream, props.workstreams, dispatch)}
                  />
                ))}
              </ul>
            </ItemListContext.Provider>
          )}
          {suggested.length > 0 && (
            <>
              <h3 class="section-title suggested-title">Suggested</h3>
              <ItemListContext.Provider value={suggested.map((each) => each.ref.id)}>
                <ul class="members" ref={suggestions}>
                  {suggested.map((each) => (
                    <Member
                      key={each.ref.id}
                      member={each}
                      adding={{ to: workstream.name, onAdd: () => add(each) }}
                    />
                  ))}
                </ul>
              </ItemListContext.Provider>
              {refused.map((said) => (
                <p key={said} class="rail-empty" role="alert">
                  {said}
                </p>
              ))}
            </>
          )}
          {/* After the lists, so the keyboard reaches them from the last row. */}
          {stack}
        </section>

        <History view={view} dispatch={dispatch} />
      </main>
    </DropZone>
  );
}

// A row's move: the item as it's carried, from this workstream, and its
// menu, which moves it as a drag onto the sidebar does: to each other open
// workstream, or to a new one.
function movingOf(
  member: MemberView,
  workstream: WorkstreamSummary,
  workstreams: WorkstreamSummary[] | null,
  dispatch: Dispatch,
): { item: Carried; menu: MenuItem[] } {
  const { ref, row } = member;
  const item: Carried = {
    id: ref.id,
    key: ref.key,
    title: row?.title ?? ref.title ?? null,
    from: { id: workstream.id, name: workstream.name },
  };
  const move = (msg: MovingMsg) => dispatch({ type: "moving", msg });
  const others = (workstreams ?? []).filter(
    (other) => other.done === null && other.id !== workstream.id,
  );
  return {
    item,
    menu: [
      ...others.map((other) => ({
        label: `Move to “${other.name}”`,
        onSelect: () => move({ type: "dropped", item, to: { id: other.id, name: other.name } }),
      })),
      { label: "Move to a new workstream", onSelect: () => move({ type: "newClicked", item }) },
    ],
  };
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
// the thread it did it in, and what an outside tool did names the tool,
// open while it is the latest version, with its Undo (decision 0058).
function History({ view, dispatch }: { view: WorkstreamView; dispatch: Dispatch }) {
  const byTool = view.changes[0]?.tool !== undefined;
  return (
    <details class="history" open={byTool || undefined}>
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
              ) : change.tool ? (
                ` · by ${change.tool}, an outside tool`
              ) : (
                causes[change.cause]
              )}
              {change.undo && (
                <>
                  {" "}
                  <button
                    type="button"
                    class="quiet-action"
                    onClick={() =>
                      dispatch({
                        type: "workstream",
                        msg: { type: "toolUndoClicked", version: change.version },
                      })
                    }
                  >
                    Undo
                  </button>
                </>
              )}
            </span>
            <span class="change-at">
              <Stamp at={change.at} />
            </span>
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
              <span class="thread-link-at">
                <Stamp at={thread.activityAt} />
              </span>
            </Link>
          </ThreadMenu>
        </li>
      ))}
    </ul>
  );
}
