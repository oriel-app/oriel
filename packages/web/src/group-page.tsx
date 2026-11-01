// A group: ask about it, see its threads, and curate its items.
import { useEffect, useRef } from "preact/hooks";
import { ThreadMenu } from "./close-thread.tsx";
import {
  askPrompt,
  type GroupModel,
  type GroupMsg,
  type Hold,
  latestUndo,
  type Removal,
  undoable,
} from "./group.ts";
import { type Dispatch, DropZone, Link, plural, StateChip, when } from "./parts.tsx";
import { Member } from "./thread-page.tsx";
import type { GroupView, ThreadStateId, ThreadSummaryView } from "./view.ts";

// `threads`: the group's, from the list the sidebar keeps, so they move as
// it does.
export function GroupPage(props: {
  model: GroupModel;
  threads: ThreadSummaryView[];
  dispatch: Dispatch;
}) {
  const { model, threads, dispatch } = props;
  const send = (msg: GroupMsg) => dispatch({ type: "group", msg });
  const { view } = model;
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The item an undo brings back: its × takes focus once it shows again.
  const back = useRef<string | null>(null);
  const undo = (removal: Removal) => {
    back.current = removal.member.ref.id;
    send({ type: "undoClicked", version: removal.version });
  };
  const latest = latestUndo(model);
  useEffect(() => {
    if (latest === null) return;
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
      undo(latest);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [latest]);
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
  if (view === null)
    return (
      <main class="page">
        {model.status === "failed" ? (
          <p class="failed" role="alert">
            This group didn't load.
          </p>
        ) : (
          <p class="loading">Loading…</p>
        )}
      </main>
    );
  const { group } = view;
  const members = view.members.filter(
    (member) => !model.removing.some((each) => each.id === member.ref.id),
  );
  return (
    <DropZone
      class="drop-page"
      label={`Drop to add to ${group.name}`}
      onDrop={(dropped) => send({ type: "dropped", dropped })}
    >
      <main class="page group-page">
        <header class="group-head">
          <input
            class="group-title"
            value={model.name ?? group.name}
            aria-label="Group name"
            maxLength={120}
            onInput={(event) => send({ type: "nameEdited", name: event.currentTarget.value })}
            onBlur={() => send({ type: "nameSaved" })}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <p class="group-origin">
            {group.origin.kind === "cluster"
              ? `Copied from a cluster in the ${group.origin.grouping} grouping`
              : group.origin.kind === "thread"
                ? "Made by a thread started from nothing"
                : "Picked by hand"}
            {" · "}
            {plural(group.size, "item")} · v{group.version}
          </p>
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
            placeholder={askPrompt(group.size)}
            aria-label="Ask about this group"
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
            <Threads threads={threads} dispatch={dispatch} showGroup={false} said={null} />
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
            <ul class="members" ref={list}>
              {members.map((member) => (
                <Member
                  key={member.ref.id}
                  member={member}
                  onRemove={() => remove(member.ref.id)}
                />
              ))}
            </ul>
          )}
          <Undos
            removals={model.removals}
            latest={latest}
            onUndo={undo}
            onHold={(by, held) => send({ type: "undoHeld", by, held })}
          />
        </section>

        <History view={view} />
      </main>
    </DropZone>
  );
}

const rowOf = (list: HTMLUListElement | null, id: string) =>
  list?.querySelector(`[data-item="${CSS.escape(id)}"]`) ?? null;

const shortcut =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Meta+Z" : "Control+Z";

// "Removed OA-12 · Undo", one for each removal that can still be undone,
// read out as it shows. None runs out while the pointer or focus is on them.
// After the list, so the keyboard reaches them from the last row.
function Undos(props: {
  removals: readonly Removal[];
  latest: Removal | null;
  onUndo(removal: Removal): void;
  onHold(by: Hold, held: boolean): void;
}) {
  const { onHold } = props;
  return (
    <div
      class="undos"
      role="status"
      onMouseEnter={() => onHold("pointer", true)}
      onMouseLeave={() => onHold("pointer", false)}
      onFocusIn={() => onHold("focus", true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onHold("focus", false);
      }}
    >
      {props.removals.map((removal) => {
        const { key } = removal.member.ref;
        return (
          <p class="undo" key={removal.version}>
            <span>Removed {key}</span>
            {undoable(removal) ? (
              <button
                type="button"
                class="undo-action"
                aria-label={`Undo removing ${key}`}
                aria-keyshortcuts={removal === props.latest ? shortcut : undefined}
                onClick={() => props.onUndo(removal)}
              >
                Undo
              </button>
            ) : (
              <span class="undo-note">It's no longer in the window, so it can't come back.</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

// The group's versions, newest first, folded.
function History({ view }: { view: GroupView }) {
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
              {change.cause === "change-set" && " · by an applied change set"}
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
  showGroup: boolean;
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
              {props.showGroup && <span class="thread-link-group">{thread.group.name}</span>}
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
