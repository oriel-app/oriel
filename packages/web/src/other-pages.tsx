// The Done page, and a review link's page.
import { Threads } from "./group-page.tsx";
import { type DoneTab, doneRoute, doneShown } from "./nav.ts";
import { type Dispatch, Link, Mark, plural } from "./parts.tsx";
import { type ReviewModel, type ReviewMsg, reviewSteps } from "./review.ts";
import { stepLabel } from "./thread.ts";
import { Diff } from "./thread-page.tsx";
import type { ChangeSetView, DiffView, ThreadSummaryView } from "./view.ts";

// The threads no longer working, most recently active first, a page at a
// time, in two tabs: done, with handed-off ones, which say so; and dropped.
// Each tab counts its threads. Threads that need the user aren't here: the
// sidebar keeps them in sight.
export function DonePage(props: {
  finished: ThreadSummaryView[] | null;
  tab: DoneTab;
  number: number;
  dispatch: Dispatch;
}) {
  const { dispatch, tab } = props;
  if (props.finished === null)
    return (
      <main class="page">
        <p class="loading">Loading…</p>
      </main>
    );
  const { counts, page, previous, next } = doneShown(props.finished, {
    tab,
    number: props.number,
  });
  const tabLink = (which: DoneTab, name: string, count: number) => (
    <Link
      route={doneRoute(which)}
      dispatch={dispatch}
      aria-current={which === tab ? "page" : undefined}
    >
      {name} <span class="nav-count">{count}</span>
    </Link>
  );
  return (
    <main class="page done-page">
      <h1 class="page-title">Done</h1>
      <nav class="tabs done-tabs" aria-label="Done or dropped">
        {tabLink("done", "Done", counts.done)}
        {tabLink("dropped", "Dropped", counts.dropped)}
      </nav>
      {page.total === 0 ? (
        <p class="rail-empty">
          {tab === "dropped"
            ? "No thread is dropped. One is once a week goes by with nothing new in it."
            : "No thread is done yet. One is once its change set is applied, or you mark it done."}
        </p>
      ) : (
        <>
          <Threads threads={page.threads} dispatch={dispatch} showGroup said={tab} />
          {page.pages > 1 && (
            <nav class="pager" aria-label={`Pages of ${tab} threads`}>
              {previous ? (
                <Link route={previous} dispatch={dispatch} class="quiet-action">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span class="pager-where">
                Page {page.number} of {page.pages} · {plural(page.total, "thread")}
              </span>
              {next ? (
                <Link route={next} dispatch={dispatch} class="quiet-action">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}

// Exactly what happened once the reviewer decided: every change made, some
// of them, or none, with each stop in plain words, next to the change it
// stopped at.
// What happened, in the engine's own terms: made, made in part, or not made;
// and a change sent without an answer may have been made, which Oriel can't
// tell. A reviewer has no steps to take here, so nothing names one.
function Outcome({
  set,
  lines,
  problem,
  dismissed,
}: {
  set: ChangeSetView;
  lines: DiffView["lines"];
  problem: string | null;
  // The reviewer dismissed what was left: none of it will be made, though a
  // change sent without an answer may have been.
  dismissed: boolean;
}) {
  const stops = set.errors.map((e) => ({
    ...e,
    sentence: lines.find((line) => line.mutationId === e.mutationId)?.sentence ?? null,
  }));
  const said: Record<ChangeSetView["status"], string> = {
    applied: "Every change in it has been made.",
    partial: set.sentUnapplied
      ? "Some of it was made. Oriel didn't hear back about one change, so it may have been made too. The rest wasn't:"
      : "Some of it was made, then Oriel stopped. The rest wasn't made:",
    stopped: set.sentUnapplied
      ? "Oriel didn't hear back about a change, so it may have been made. Nothing else was:"
      : "None of it was made: Oriel stopped at the first change it couldn't make.",
    approved: "It's approved, and hasn't been made yet.",
    applying: "It's being made now.",
    rejected: "Nothing will be changed.",
    open: "Nothing has been changed.",
  };
  const made =
    set.status === "partial"
      ? "Some of it was made; the rest won't be."
      : "None of the rest will be made.";
  const unsure = set.sentUnapplied
    ? " Oriel didn't hear back about one change, so it may have been made anyway:"
    : "";
  return (
    <>
      <p class="outcome" data-status={set.status}>
        {dismissed ? `${made}${unsure}` : said[set.status]}
      </p>
      {stops.length > 0 && (
        <ul class="outcome-stops">
          {stops.map((stop) => (
            <li key={stop.mutationId}>
              {stop.sentence && <span class="stop-change">{stop.sentence} </span>}
              <span class="stop-reason">
                {stop.sent ? "This may have been made; Oriel didn't hear back." : stop.error}
              </span>
            </li>
          ))}
        </ul>
      )}
      {problem && <p class="stop-reason">{problem}</p>}
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
            {model.outcome === "dismissed"
              ? "You dismissed the rest of this change"
              : model.decided?.decision?.kind === "approved"
                ? "You approved this change"
                : "You rejected this change"}
          </h1>
          <p>Thanks, {model.decided?.decision?.by}.</p>
          {model.outcome === "rejected" && model.reason.trim() && !model.problem && (
            <p>
              What you said is in the thread for whoever shared this link. They decide whether the
              agent sees it.
            </p>
          )}
          {model.warnings.length > 0 && (
            <ul class="may-have-landed" role="note">
              {model.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {model.decided && (
            <Outcome
              set={model.decided}
              lines={model.view?.diff.lines ?? []}
              problem={model.problem}
              dismissed={model.outcome === "dismissed"}
            />
          )}
        </section>
      ) : (
        model.view && (
          <ReviewChange
            view={model.view}
            name={model.name}
            reason={model.reason}
            deciding={model.stage === "deciding"}
            applying={model.stage === "deciding" && model.outcome === "approved"}
            problem={model.problem}
            send={send}
          />
        )
      )}
    </main>
  );
}

// The change and what the reviewer can do with it: exactly the steps the
// change set engine offers that a review link can take, as the thread shows
// them, with what dismissing says may have landed.
function ReviewChange(props: {
  view: NonNullable<ReviewModel["view"]>;
  name: string;
  reason: string;
  deciding: boolean;
  // Approving here, and being applied: the click landed.
  applying: boolean;
  problem: string | null;
  send: (msg: ReviewMsg) => void;
}) {
  const { view, name, reason, deciding, problem, send } = props;
  const steps = reviewSteps(view);
  const dismissing = view.changeSet.nextSteps.find((step) => step.kind === "dismiss");
  const approving = steps.find((step) => step === "approve" || step === "approve-rest");
  return (
    <section class="review-card">
      <h1 class="page-title">Review this change</h1>
      <Diff diff={view.diff} busy={false} />
      {dismissing?.kind === "dismiss" && dismissing.warnings.length > 0 && (
        <ul class="may-have-landed">
          {dismissing.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {steps.length === 0 ? (
        <p class="read-only-note">
          {view.changeSet.applying
            ? "Applying…"
            : "There's nothing to decide here now. Whoever shared this link can take it from the thread."}
        </p>
      ) : (
        <form
          class="review-decide"
          onSubmit={(event) => {
            event.preventDefault();
            if (approving) send({ type: "decideClicked", kind: "approved" });
          }}
        >
          {steps.includes("reject") && !view.changeSet.revertOf && (
            <label class="name-field reason">
              If you reject it, what's wrong? (optional)
              <textarea
                value={reason}
                rows={2}
                // The server's maxReasonChars.
                maxLength={2000}
                onInput={(event) =>
                  send({ type: "reasonChanged", reason: event.currentTarget.value })
                }
              />
            </label>
          )}
          <label class="name-field">
            Your name
            <input
              value={name}
              maxLength={120}
              autoComplete="name"
              onInput={(event) => send({ type: "nameChanged", name: event.currentTarget.value })}
            />
          </label>
          <div class="review-actions">
            {steps.map((step) => (
              <button
                key={step}
                type={step === approving ? "submit" : "button"}
                class={
                  step === approving
                    ? "button primary"
                    : step === "dismiss"
                      ? "quiet-action"
                      : "button"
                }
                disabled={deciding}
                onClick={
                  step === approving
                    ? undefined
                    : () =>
                        send(
                          step === "dismiss"
                            ? { type: "dismissClicked" }
                            : { type: "decideClicked", kind: "rejected" },
                        )
                }
              >
                {step === "approve" ? "Approve" : stepLabel(step, view.changeSet)}
              </button>
            ))}
          </div>
        </form>
      )}
      <p class="read-only-note" role="status">
        {props.applying && "Approving and applying…"}
      </p>
      {problem && (
        <p class="change-set-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
