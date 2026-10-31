// A group: ask about it, see its threads, and curate its items.
import type { GroupModel, GroupMsg } from "./group.ts";
import { type Dispatch, DropZone, Link, plural, StateChip, when } from "./parts.tsx";
import { Member } from "./thread-page.tsx";
import type { GroupView, ThreadSummaryView } from "./view.ts";

export function GroupPage({ model, dispatch }: { model: GroupModel; dispatch: Dispatch }) {
  const send = (msg: GroupMsg) => dispatch({ type: "group", msg });
  const { view } = model;
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
            placeholder={`Ask about these ${plural(group.size, "item")}…`}
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

        {view.threads.length > 0 && (
          <section class="section">
            <h2 class="section-title">Threads</h2>
            <Threads threads={view.threads} dispatch={dispatch} showGroup={false} />
          </section>
        )}

        <section class="section">
          <div class="section-head">
            <h2 class="section-title">Items</h2>
            <button type="button" class="quiet-action" onClick={() => send({ type: "addClicked" })}>
              Add from the window
            </button>
          </div>
          {view.members.length === 0 ? (
            <p class="rail-empty">No items. Add some from the window.</p>
          ) : (
            <ul class="members">
              {view.members.map((member) => (
                <Member
                  key={member.ref.id}
                  member={member}
                  onRemove={
                    model.pending
                      ? undefined
                      : () => send({ type: "memberRemoved", id: member.ref.id })
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <History view={view} />
      </main>
    </DropZone>
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

export function Threads(props: {
  threads: ThreadSummaryView[];
  dispatch: Dispatch;
  showGroup: boolean;
}) {
  return (
    <ul class="thread-list">
      {props.threads.map((thread) => (
        <li key={thread.id}>
          <Link
            route={{ page: "thread", id: thread.id }}
            dispatch={props.dispatch}
            class="thread-link"
          >
            <span class="thread-link-title">{thread.title ?? "New thread"}</span>
            {props.showGroup && <span class="thread-link-group">{thread.group.name}</span>}
            {(!props.showGroup || thread.waitingOn) && (
              <StateChip state={thread.state} waitingOn={thread.waitingOn} />
            )}
            <span class="thread-link-at">{when(thread.activityAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
