// A workstream's release rehearsal (the release-rehearsal spike): the
// situations its customers will meet, in order, each with the items that
// bear on it and what nobody has answered. The situations and what each item
// says are the agent's reading, and say so; every item is a chip, with its
// state from its source now, and every quote is one Oriel found word for
// word. Intent, a claim that it's built, and what someone saw it do stay
// apart, and where no item reports seeing it work, the page says that.
// Nothing here is a score.
import { chipState } from "./chip.ts";
import { Chip, plural, Stamp } from "./parts.tsx";
import type { ChipView, Chips, RehearsalSituation, RehearsalView } from "./view.ts";

type Evidence = RehearsalSituation["evidence"][number];

function Named({ id, chips }: { id: string; chips: Chips }) {
  const view = chips[id];
  if (!view)
    return (
      <span class="chip" data-unknown="" title="Oriel has nothing with this ID">
        unknown reference
      </span>
    );
  return <Chip id={id} view={view} />;
}

function Quote({ text }: { text: string }) {
  return (
    <blockquote class="rehearsal-quote" title="Oriel found these words in the item, word for word">
      {text}
    </blockquote>
  );
}

const done = (view: ChipView | null | undefined) => !!view && chipState(view) === "done";

// The situation's items, by what they say. "Claimed built" is what the agent
// read as a claim, and every item whose source calls it done: a state is a
// claim, never something observed.
function Ladder({ situation, chips }: { situation: RehearsalSituation; chips: Chips }) {
  const of = (says: Evidence["says"]) => situation.evidence.filter((e) => e.says === says);
  const claimed = of("claim");
  const stated = [...new Set(situation.evidence.map((e) => e.id))].filter(
    (id) => done(chips[id]) && !claimed.some((e) => e.id === id),
  );
  const rows = (list: Evidence[]) =>
    list.map((each, i) => (
      <li key={`${each.id}-${i}`}>
        <Named id={each.id} chips={chips} />
        {each.quote && <Quote text={each.quote} />}
      </li>
    ));
  const tested = of("observed");
  const contradictions = of("contradiction");
  return (
    <dl class="ladder">
      <dt>Documented intent</dt>
      <dd>
        {of("intent").length ? (
          <ul>{rows(of("intent"))}</ul>
        ) : (
          <p class="rail-empty">No item says what should happen.</p>
        )}
      </dd>
      <dt>Claimed built</dt>
      <dd>
        {claimed.length || stated.length ? (
          <ul>
            {rows(claimed)}
            {stated.map((id) => (
              <li key={id}>
                <Named id={id} chips={chips} />
                <span class="ladder-rule">
                  {" "}
                  Done in its source: a claim, not something observed
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="rail-empty">No item says it's built.</p>
        )}
      </dd>
      <dt>Observed</dt>
      <dd>
        {tested.length ? (
          <ul>{rows(tested)}</ul>
        ) : (
          <p class="rail-empty">Nobody reports seeing it happen: no test, check or real case.</p>
        )}
      </dd>
      {contradictions.length > 0 && (
        <>
          <dt>Contradictions</dt>
          <dd>
            <ul>
              {contradictions.map((each, i) => (
                <li key={`${each.id}-${i}`} data-tone="warn">
                  <Named id={each.id} chips={chips} />
                  {each.against && each.against !== each.id && (
                    <>
                      {" disagrees with "}
                      <Named id={each.against} chips={chips} />
                    </>
                  )}
                  {each.against === each.id && " disagrees with its own state"}
                  {each.quote && <Quote text={each.quote} />}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
}

type StaleKind = NonNullable<RehearsalView["rehearsal"]>["stale"][number]["kind"];

const staleWords: Record<StaleKind, (n: number) => string> = {
  changed: (n) => `${plural(n, "item")} changed`,
  gone: (n) => `${plural(n, "item")} gone from the index`,
  added: (n) => `${plural(n, "item")} joined the workstream`,
  removed: (n) => `${plural(n, "item")} left it`,
};

export function Rehearsal(props: {
  view: RehearsalView | null | undefined;
  asking: boolean;
  onRehearse: () => void;
  onFollowUp: (situation: number) => void;
}) {
  const { view, asking } = props;
  if (view === undefined) return null;
  const kept = view?.rehearsal ?? null;
  const running = view?.thread.running ?? false;
  const again = (label: string) => (
    <button
      type="button"
      class="quiet-action"
      disabled={asking || running}
      onClick={props.onRehearse}
    >
      {label}
    </button>
  );
  return (
    <section class="section rehearsal">
      <div class="section-head">
        <h2 class="section-title">Release rehearsal</h2>
        {view === null ? null : again("Rehearse again")}
      </div>
      {view === null && (
        <div class="rehearsal-start">
          <p class="rail-empty">
            Walk this workstream through as the situations its customers will meet: what each item
            says of them, and what nobody has answered. The agent reads every item in a thread of
            its own; nothing changes in your sources.
          </p>
          <button type="button" class="button primary" disabled={asking} onClick={props.onRehearse}>
            Rehearse the release
          </button>
        </div>
      )}
      {view && !kept && (
        <p class="rail-empty">
          {running ? "The agent is rehearsing in " : "No rehearsal was kept in "}
          <Named id={view.thread.id} chips={view.chips} />
          {running ? "…" : "."}
        </p>
      )}
      {view && kept && (
        <>
          <p class="rehearsal-caption">
            The agent's reading, in <Named id={view.thread.id} chips={view.chips} />,{" "}
            <Stamp at={kept.at} />. States are each source's now; Oriel found every quote word for
            word.
          </p>
          {kept.stale.length > 0 && (
            <p class="notice" data-tone="warn">
              Stale: since it was kept,{" "}
              {kept.stale.map((s) => staleWords[s.kind](s.ids.length)).join(", ")}. Rehearse again
              to read them.
            </p>
          )}
          <ol class="situations">
            {kept.situations.map((situation, i) => {
              const ups = view.followUps.find((up) => up.situation === i + 1);
              return (
                <li class="situation" key={i}>
                  <div class="situation-head">
                    <span class="situation-n">{i + 1}</span>
                    <h3 class="situation-title">{situation.title}</h3>
                    <button
                      type="button"
                      class="button"
                      disabled={asking || running}
                      onClick={() => props.onFollowUp(i + 1)}
                    >
                      Prepare follow-up work
                    </button>
                  </div>
                  <Ladder situation={situation} chips={view.chips} />
                  <div class="unanswered">
                    <h4>Nobody has answered</h4>
                    {situation.unanswered.length ? (
                      <ul>
                        {situation.unanswered.map((q, n) => (
                          <li key={n}>
                            {q.question}
                            {q.id && (
                              <span class="asked">
                                {" "}
                                Asked in <Named id={q.id} chips={view.chips} />
                              </span>
                            )}
                            {q.quote && <Quote text={q.quote} />}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p class="rail-empty">The agent found nothing left open here.</p>
                    )}
                  </div>
                  {ups && (
                    <p class="follow-ups">
                      Follow-up work:{" "}
                      {ups.changeSets.length
                        ? ups.changeSets.map((id) => <Named key={id} id={id} chips={view.chips} />)
                        : "asked, nothing proposed yet"}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
