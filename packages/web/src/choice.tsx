// A choice the agent found (the decision-desk spike), as a card under its
// reply. Two voices, kept apart: the agent's reading (the question, each
// option's label and standing, what each quote does, what's unanswered),
// captioned as the agent's; and Oriel's (each quote, found word for word in
// its item, with who said it and when, as the source records it, and
// whether an item changed since). The controls are Oriel's: Choose, Defer,
// Ask for clarification and Reopen, and nothing the agent wrote is one.
// "Why is it this way?" orders the dated quotes and Oriel's own records by
// their real times, with the agent's reading beside each, never in place of
// it.
import type { ChoiceView, ChatEntry, EvidenceView, NoteView } from "./view.ts";
import { ItemKey } from "./parts.tsx";
import { when } from "./time.ts";
import { Tooltip } from "./tooltip.tsx";
import type { ThreadMsg } from "./thread.ts";

const letters = "ABCDE";
export const optionLetter = (index: number) => letters[index] ?? String(index + 1);

const standingNames = { proposed: "Proposed", agreed: "Agreed", superseded: "Superseded" };
const roleNames = {
  proposes: "proposes",
  agrees: "agrees",
  objects: "objects",
  amends: "amends",
  asks: "asks",
};

type ChoiceNote = Extract<NoteView, { kind: "choice" }>;

// What the user last did with a choice, from Oriel's lines in the thread.
export function settledOf(
  entries: readonly ChatEntry[],
  choiceId: string,
): (ChoiceNote & { at: string }) | null {
  let last: (ChoiceNote & { at: string }) | null = null;
  for (const entry of entries)
    if (entry.kind === "note" && entry.note.kind === "choice" && entry.note.choiceId === choiceId)
      last = { ...entry.note, at: entry.at };
  return last?.outcome === "reopened" ? null : last;
}

// The choice's history, oldest first: each dated quote, each item's body
// as of when it last changed, each item's last change as the index has it,
// Oriel's check, and what the user did.
type Moment = { at: string; by: "source" | "oriel"; key: string; line: preact.ComponentChildren };

function history(choice: ChoiceView, settled: (ChoiceNote & { at: string }) | null): Moment[] {
  const itemOf = (id: string) => choice.items.find((item) => item.id === id);
  const moments: Moment[] = [];
  choice.options.forEach((option, index) =>
    option.evidence.forEach((e, n) => {
      const item = itemOf(e.id);
      moments.push({
        at: e.at ?? e.asOf,
        by: "source",
        key: `q${index}-${n}`,
        line: (
          <>
            <span class="moment-who">
              {e.at
                ? (e.author ?? "Someone")
                : `${item?.key ?? e.id}'s ${e.place.toLowerCase()}, as it stood`}
            </span>{" "}
            <q class="moment-quote">{e.quote}</q>{" "}
            <span class="agent-reading">
              agent: {roleNames[e.role]} {optionLetter(index)}
            </span>
          </>
        ),
      });
    }),
  );
  for (const item of choice.items)
    moments.push({
      at: item.updatedAt ?? choice.checkedAt,
      by: "oriel",
      key: `i${item.id}`,
      line: item.updatedAt ? (
        <>
          <ItemKey item={item} /> last changed in {item.source}
          {item.changed && ", since Oriel checked this choice"}
        </>
      ) : (
        <>
          <ItemKey item={item} /> is gone from {item.source}
        </>
      ),
    });
  moments.push({
    at: choice.checkedAt,
    by: "oriel",
    key: "checked",
    line: <>Oriel checked every quote word for word</>,
  });
  if (settled)
    moments.push({
      at: settled.at,
      by: "oriel",
      key: "settled",
      line: <>{settledLine(settled)}</>,
    });
  // Quotes from one message keep their order; ties go to the source first.
  return moments
    .map((moment, i) => ({ moment, i }))
    .sort((a, b) => Date.parse(a.moment.at) - Date.parse(b.moment.at) || a.i - b.i)
    .map(({ moment }) => moment);
}

export function settledLine(note: Pick<ChoiceNote, "outcome" | "option" | "label">): string {
  switch (note.outcome) {
    case "chosen":
      return `You chose ${optionLetter(note.option ?? 0)}: ${note.label ?? ""}`;
    case "deferred":
      return "You deferred this choice";
    case "asked":
      return "You asked for clarification";
    case "reopened":
      return "You reopened this choice";
  }
}

function Quote({ e, item }: { e: EvidenceView; item: ChoiceView["items"][number] | undefined }) {
  return (
    <li class="choice-quote" data-role={e.role}>
      <blockquote>{e.quote}</blockquote>
      <p class="choice-said">
        <span class="oriel-says">
          Word for word from {item ? <ItemKey item={item} /> : e.id}
          {e.at ? (
            <>
              {" · "}
              {e.author ?? "someone"}
              {" · "}
              <time dateTime={e.at}>{when(e.at)}</time>
            </>
          ) : (
            <>
              {" · its "}
              {e.place.toLowerCase()}, as of <time dateTime={e.asOf}>{when(e.asOf)}</time>
            </>
          )}
        </span>{" "}
        <span class="agent-reading">agent: {roleNames[e.role]}</span>
      </p>
    </li>
  );
}

export function ChoiceCard(props: {
  choice: ChoiceView;
  entries: readonly ChatEntry[];
  running: boolean;
  // A later run in the thread found choices again.
  replaced: boolean;
  send: (msg: ThreadMsg) => void;
}) {
  const { choice, running, send } = props;
  const settled = settledOf(props.entries, choice.id);
  const changed = choice.items.filter((item) => item.changed);
  const sources = [...new Set(choice.items.map((item) => item.source))].join(" and ");
  const settle = (outcome: "chosen" | "deferred" | "asked" | "reopened", option?: number) =>
    send({
      type: "choiceClicked",
      choiceId: choice.id,
      outcome,
      ...(option === undefined ? {} : { option }),
    });
  return (
    <section
      class="choice-card"
      aria-label="A choice the agent found"
      data-settled={settled?.outcome}
    >
      <header class="choice-head">
        <p class="choice-kicker">Open choice · the agent's reading</p>
        <h3 class="choice-question">{choice.question}</h3>
      </header>
      {(changed.length > 0 || props.replaced) && (
        <p class="choice-stale" role="status">
          {changed.length > 0 ? (
            <>
              Changed since Oriel checked this:{" "}
              {changed.map((item, i) => (
                <>
                  {i > 0 && ", "}
                  <ItemKey item={item} />
                </>
              ))}
              .{" "}
            </>
          ) : (
            "A later check in this thread found choices again. "
          )}
          {!props.replaced && (
            <button
              type="button"
              class="quiet-action"
              disabled={running}
              onClick={() => send({ type: "choicesClicked" })}
            >
              Check again
            </button>
          )}
        </p>
      )}
      <ol class="choice-options">
        {choice.options.map((option, index) => {
          const chosen = settled?.outcome === "chosen" && settled.option === index;
          return (
            <li
              class="choice-option"
              data-standing={option.standing}
              data-chosen={chosen || undefined}
            >
              <div class="choice-option-head">
                <span class="choice-letter">{optionLetter(index)}</span>
                <span class="choice-label">{option.label}</span>
                <span class="choice-standing" data-standing={option.standing}>
                  {standingNames[option.standing]}
                  <span class="agent-reading"> · agent's reading</span>
                </span>
              </div>
              <ul class="choice-quotes">
                {option.evidence.map((e) => (
                  <Quote e={e} item={choice.items.find((item) => item.id === e.id)} />
                ))}
              </ul>
              {chosen ? (
                <p class="choice-chosen">You chose this</p>
              ) : (
                settled?.outcome !== "chosen" &&
                settled?.outcome !== "deferred" && (
                  <Tooltip text="Oriel records your choice, and the agent proposes a change set that carries it into the work. Nothing changes until you approve it.">
                    <button
                      type="button"
                      class="choice-choose"
                      disabled={running}
                      onClick={() => settle("chosen", index)}
                    >
                      Choose {optionLetter(index)}
                    </button>
                  </Tooltip>
                )
              )}
            </li>
          );
        })}
      </ol>
      {choice.open.length > 0 && (
        <div class="choice-open">
          <p class="choice-open-head">
            Still unanswered <span class="agent-reading">· agent's reading</span>
          </p>
          <ul>
            {choice.open.map((question) => (
              <li>{question}</li>
            ))}
          </ul>
        </div>
      )}
      <footer class="choice-foot">
        {settled && <p class="choice-settled">{settledLine(settled)}.</p>}
        <div class="choice-actions">
          {settled?.outcome === "chosen" || settled?.outcome === "deferred" ? (
            <button
              type="button"
              class="quiet-action"
              disabled={running}
              onClick={() => settle("reopened")}
            >
              Reopen
            </button>
          ) : (
            <>
              <Tooltip text="Keep it open for now. Nothing is sent, and the agent isn't asked anything.">
                <button
                  type="button"
                  class="quiet-action"
                  disabled={running}
                  onClick={() => settle("deferred")}
                >
                  Defer
                </button>
              </Tooltip>
              <Tooltip text="The agent drafts a reply asking what's unanswered, as a change set for you to review.">
                <button
                  type="button"
                  class="quiet-action"
                  disabled={running || settled?.outcome === "asked"}
                  onClick={() => settle("asked")}
                >
                  Ask for clarification
                </button>
              </Tooltip>
            </>
          )}
        </div>
        <details class="choice-history">
          <summary>Why is it this way?</summary>
          <ol class="moments">
            {history(choice, settled).map((moment) => (
              <li class="moment" data-by={moment.by} key={moment.key}>
                <time dateTime={moment.at}>{when(moment.at)}</time>
                <span class="moment-line">{moment.line}</span>
              </li>
            ))}
          </ol>
          <p class="moments-key">
            Dates are the sources' own. Lines marked ◆ are Oriel's records; “agent:” is the agent's
            reading of a quote.
          </p>
        </details>
        <p class="choice-caption">
          The question, the options, where each stands and what each quote does are the agent's
          reading. Oriel found each quote word for word and dated it from {sources}; it didn't judge
          who agreed.
        </p>
      </footer>
    </section>
  );
}
