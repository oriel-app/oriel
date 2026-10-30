// The inbox, and a review link's page.
import { Threads } from "./group-page.tsx";
import { type Dispatch, Mark, stateNames } from "./parts.tsx";
import type { ReviewModel, ReviewMsg } from "./review.ts";
import { Diff } from "./thread-page.tsx";
import { type ChangeSetView, type DiffView, threadStates, type ThreadSummaryView } from "./view.ts";

// Threads by state: working first, then what settled.
export function InboxPage(props: { threads: ThreadSummaryView[] | null; dispatch: Dispatch }) {
  const { threads, dispatch } = props;
  if (threads === null)
    return (
      <main class="page">
        <p class="loading">Loading…</p>
      </main>
    );
  return (
    <main class="page inbox">
      <h1 class="page-title">Inbox</h1>
      {threads.length === 0 && (
        <p class="rail-empty">No threads yet. Open a group and ask about it.</p>
      )}
      {threadStates.map((state) => {
        const these = threads.filter((thread) => thread.state === state);
        if (these.length === 0) return null;
        return (
          <section key={state} class="section" data-state={state}>
            <h2 class="section-title">
              {stateNames[state]} <span class="section-count">{these.length}</span>
            </h2>
            <Threads threads={these} dispatch={dispatch} showGroup />
          </section>
        );
      })}
    </main>
  );
}

// Exactly what happened once the reviewer decided: every change made, some
// of them, or none, with each stop in plain words, next to the change it
// stopped at.
function Outcome({ set, lines }: { set: ChangeSetView; lines: DiffView["lines"] }) {
  const stops = set.errors.map((e) => ({
    ...e,
    sentence: lines.find((line) => line.mutationId === e.mutationId)?.sentence ?? null,
  }));
  const said: Record<ChangeSetView["status"], string> = {
    applied: "Every change in it has been made.",
    partial: "Some of it was made, then Oriel stopped. The rest wasn't made:",
    stopped: "None of it was made: Oriel stopped at the first change it couldn't make.",
    approved: "It's approved, and hasn't been made yet.",
    rejected: "Nothing will be changed.",
    open: "Nothing has been changed.",
  };
  return (
    <>
      <p class="outcome" data-status={set.status}>
        {said[set.status]}
      </p>
      {stops.length > 0 && (
        <ul class="outcome-stops">
          {stops.map((stop) => (
            <li key={stop.mutationId}>
              {stop.sentence && <span class="stop-change">{stop.sentence} </span>}
              <span class="stop-reason">{stop.error}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ReviewPage({ model, dispatch }: { model: ReviewModel; dispatch: Dispatch }) {
  const send = (msg: ReviewMsg) => dispatch({ type: "review", msg });
  return (
    <main class="review">
      <header class="review-head">
        <Mark />
        <span>Oriel</span>
      </header>
      {model.stage === "closed" || model.stage === "opening" ? (
        <section class="review-card">
          <h1 class="page-title">A change to review</h1>
          <p>
            Someone using Oriel wants a change made and shared this link so you can review it.
            Nothing is changed until it is approved.
          </p>
          <button
            type="button"
            class="button primary"
            disabled={model.stage === "opening"}
            onClick={() => send({ type: "openClicked" })}
          >
            Show the change
          </button>
        </section>
      ) : model.stage === "dead" ? (
        <section class="review-card">
          <h1 class="page-title">This link no longer works</h1>
          <p>{model.problem}</p>
        </section>
      ) : model.stage === "decided" ? (
        <section class="review-card">
          <h1 class="page-title">
            {model.decided?.decision?.kind === "approved"
              ? "You approved this change"
              : "You rejected this change"}
          </h1>
          <p>Thanks, {model.decided?.decision?.by}.</p>
          {model.decided && <Outcome set={model.decided} lines={model.view?.diff.lines ?? []} />}
        </section>
      ) : (
        model.view && (
          <section class="review-card">
            <h1 class="page-title">Review this change</h1>
            <Diff diff={model.view.diff} busy={false} />
            <form
              class="review-decide"
              onSubmit={(event) => {
                event.preventDefault();
                send({ type: "decideClicked", kind: "approved" });
              }}
            >
              <label class="name-field">
                Your name
                <input
                  value={model.name}
                  maxLength={120}
                  autoComplete="name"
                  onInput={(event) =>
                    send({ type: "nameChanged", name: event.currentTarget.value })
                  }
                />
              </label>
              <div class="review-actions">
                <button type="submit" class="button primary" disabled={model.stage === "deciding"}>
                  Approve
                </button>
                <button
                  type="button"
                  class="button"
                  disabled={model.stage === "deciding"}
                  onClick={() => send({ type: "decideClicked", kind: "rejected" })}
                >
                  Reject
                </button>
              </div>
            </form>
            {model.problem && (
              <p class="change-set-problem" role="alert">
                {model.problem}
              </p>
            )}
          </section>
        )
      )}
    </main>
  );
}
