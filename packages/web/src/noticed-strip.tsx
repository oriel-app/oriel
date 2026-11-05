// Noticed (decision 0052): the overview's strip of what
// Oriel found unasked, and the pins. A card's kind, subject, headline, rule
// and block are Oriel's; its one line is the agent's, checked by Oriel and
// captioned as the agent's; a quote is shown only once found word for word.
// Pin saves the card's block as a read rerun on each look; Ask about this
// opens the window chat on it, by ID; Dismiss keeps it away until its
// figures move on.
import type { SignalKind } from "@oriel/core/noticed";
import { BlockFigure } from "./block.tsx";
import { askAbout, type OverviewMsg } from "./overview.ts";
import { AnswerChip, ChipsContext, type Dispatch, Link, Markdown, useStamp } from "./parts.tsx";
import { Tooltip } from "./tooltip.tsx";
import type { BlockView, NoticedView, PinView } from "./view.ts";

const kindLabels: Record<SignalKind, string> = {
  stalled: "Stalled",
  drift: "Estimates rose",
  overloaded: "A lot in progress",
  contradicted: "Chat after done",
  scope: "Scope grew",
};

// A card's or a pin's block at its first rows, as a pin shows it (0030). A
// chart keeps every mark: its compact drawing is its own (decision 0053).
function topOf(block: BlockView, n: number): BlockView {
  if (block.form === "rows")
    return {
      ...block,
      items: block.items.slice(0, n),
      more: block.more + Math.max(0, block.items.length - n),
    };
  if (block.form === "table")
    return {
      ...block,
      rows: block.rows.slice(0, n),
      more: block.more + Math.max(0, block.rows.length - n),
    };
  if (block.form !== "bars") return block;
  return {
    ...block,
    bars: block.bars.slice(0, n + 2),
    more: block.more + Math.max(0, block.bars.length - n - 2),
  };
}

export function NoticedStrip(props: {
  view: NoticedView | null;
  busy: string | null;
  problem: string | null;
  dispatch: Dispatch;
}) {
  const { view, dispatch } = props;
  const stamp = useStamp();
  // Hidden with no model, and until a pass has something to say: none has
  // run yet, or nothing holds now.
  const empty = view?.cards.length === 0;
  if (
    !view ||
    view.status === "no-ai" ||
    (empty && view.status === "quiet") ||
    (empty && view.status === "ready" && view.foundAt === null)
  )
    return null;
  const send = (msg: OverviewMsg) => dispatch({ type: "overview", msg });
  return (
    <section class="overview-section noticed" data-section="noticed" aria-label="Noticed">
      <h2 class="overview-head">
        Noticed
        <span class="noticed-by">
          {view.status === "running"
            ? "Looking at what changed…"
            : view.foundAt
              ? `Found by Oriel's rules, picked by the agent, ${stamp(view.foundAt)}`
              : null}
        </span>
      </h2>
      {view.cards.length === 0 && view.status === "ready" && (
        <p class="noticed-none">Nothing Oriel found needs you now.</p>
      )}
      {(props.problem ?? view.problem) && (
        <p class="overview-problem" role="alert">
          {props.problem ?? view.problem}
        </p>
      )}
      <ChipsContext.Provider value={view.chips}>
        <div class="noticed-cards">
          {view.cards.map((card) => (
            <article class="noticed-card" key={card.signal} data-kind={card.kind}>
              <header class="noticed-card-head">
                <span class="noticed-kind">{kindLabels[card.kind]}</span>
                <Tooltip text={`Oriel rule: ${card.rule}`}>
                  <span class="noticed-rule-mark" tabIndex={0} aria-label="Oriel's rule">
                    ⓘ
                  </span>
                </Tooltip>
                <span class="noticed-subject">
                  {card.subject.kind === "workstream" ? (
                    <Link route={{ page: "workstream", id: card.subject.id }} dispatch={dispatch}>
                      {card.subject.name}
                    </Link>
                  ) : card.subject.kind === "item" ? (
                    <AnswerChip id={card.subject.id} />
                  ) : (
                    card.subject.name
                  )}
                </span>
              </header>
              <p class="noticed-headline">{card.headline}</p>
              {card.why && (
                <div class="noticed-why">
                  <Markdown text={card.why} linksTo={new Set()} answer />
                  <p class="noticed-why-by">The agent's words, unasked</p>
                </div>
              )}
              {card.quote && (
                <figure class="quote-from" data-found="true">
                  <figcaption>
                    Word for word from <AnswerChip id={card.quote.item} />
                  </figcaption>
                  <blockquote>
                    <p>{card.quote.text}</p>
                  </blockquote>
                </figure>
              )}
              {card.block && <BlockFigure block={topOf(card.block, 3)} />}
              <footer class="noticed-actions">
                {card.pinned ? (
                  <span class="noticed-pinned">Pinned</span>
                ) : (
                  <button
                    type="button"
                    class="quiet-action"
                    disabled={props.busy !== null}
                    onClick={() => send({ type: "pinClicked", signal: card.signal })}
                  >
                    Pin
                  </button>
                )}
                <button
                  type="button"
                  class="quiet-action"
                  onClick={() =>
                    dispatch({
                      type: "chat",
                      msg: { type: "questionPicked", question: askAbout(card) },
                    })
                  }
                >
                  Ask about this
                </button>
                <button
                  type="button"
                  class="quiet-action"
                  disabled={props.busy !== null}
                  onClick={() => send({ type: "dismissClicked", signal: card.signal })}
                >
                  Dismiss
                </button>
                <Tooltip text="It stays away until its figures move on.">
                  <span class="noticed-rule-mark" tabIndex={0} aria-label="About Dismiss">
                    ⓘ
                  </span>
                </Tooltip>
              </footer>
            </article>
          ))}
        </div>
      </ChipsContext.Provider>
      {view.taught.map((line) => (
        <p class="noticed-taught" key={line}>
          {line}
        </p>
      ))}
    </section>
  );
}

// The pins (decision 0030): each block rerun now, at its first rows.
export function PinnedStrip(props: {
  pins: readonly PinView[];
  busy: string | null;
  dispatch: Dispatch;
}) {
  const { pins, dispatch } = props;
  if (pins.length === 0) return null;
  return (
    <section class="overview-section pinned" data-section="pinned" aria-label="Pinned">
      <h2 class="overview-head">
        Pinned <span class="noticed-by">rerun each time you look</span>
      </h2>
      <div class="pinned-blocks">
        {pins.map((pin) => (
          <div class="pinned-block" key={pin.id}>
            {pin.block ? (
              <BlockFigure block={topOf(pin.block, 3)} compact />
            ) : (
              <p class="noticed-none">What this pin read isn't there any more.</p>
            )}
            <button
              type="button"
              class="quiet-action"
              disabled={props.busy !== null}
              onClick={() =>
                dispatch({ type: "overview", msg: { type: "unpinClicked", pin: pin.id } })
              }
            >
              Unpin
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
