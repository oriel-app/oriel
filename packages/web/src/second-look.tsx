// Never a verdict: nothing here approves, rejects or blocks, and nothing looks like a pass
// (no tick, no green, no score). What the agent concluded is captioned as its own.
import { AnswerChip, ChipsContext, plural } from "./parts.tsx";
import type { DiffView, SecondLookView, ThreadView } from "./view.ts";

type Finding = SecondLookView["findings"][number];

const kinds: readonly { kind: Finding["kind"]; heading: string }[] = [
  { kind: "conflict", heading: "Disagrees with something decided" },
  { kind: "discussion", heading: "A discussion this affects" },
  { kind: "companion", heading: "May need to change with it" },
  { kind: "related", heading: "Worth a look" },
];

// Never its words.
function coverage(look: SecondLookView): string | null {
  const read = look.coverage;
  if (!read) return null;
  const searched =
    read.searches === 0
      ? "and didn't search outside it"
      : `and searched outside it ${read.searches === 1 ? "once" : `${read.searches} times`}`;
  return `It read ${read.read.length} of ${plural(read.of, "item")} in this workstream, ${searched}. It can't speak for what it didn't read.`;
}

export function SecondLook(props: {
  look: SecondLookView;
  diff: DiffView | undefined;
  view: ThreadView;
  busy: boolean;
  onAdd(place: number): void;
}) {
  const { look, diff, busy } = props;
  const stale = look.stale.diff || look.stale.items.length > 0;
  const added = look.companions.some((c) => c.added);
  const on = (n: number) => diff?.lines[n - 1]?.target?.key ?? `change ${n}`;
  return (
    <ChipsContext.Provider value={props.view.chips}>
      <section class="second-look" data-state={look.state} aria-label="Second look">
        <header class="second-look-head">
          <h3>Second look</h3>
          <span class="second-look-by">
            Taking a second look. Read carefully before accepting any changes
          </span>
        </header>
        {look.state === "running" && (
          <p class="second-look-note" role="status">
            Reading what this change touches. Dismiss it to decide without it.
          </p>
        )}
        {look.state === "failed" && (
          <p class="second-look-note">It didn't finish{look.error ? `: ${look.error}` : "."}</p>
        )}
        {look.state === "ready" && (
          <>
            {stale && (
              <p class="second-look-stale" role="note">
                {look.stale.diff
                  ? added
                    ? "You added a suggestion since it looked; nobody has looked at what that adds. "
                    : "The change set changed after it looked. "
                  : ""}
                {look.stale.items.length > 0 && (
                  <>
                    {plural(look.stale.items.length, "item")} it rests on changed since:{" "}
                    {look.stale.items.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ", "}
                        <AnswerChip id={id} />
                      </span>
                    ))}
                    .
                  </>
                )}
              </p>
            )}
            <p class="second-look-read">{coverage(look)}</p>
            {look.findings.length === 0 ? (
              <p class="second-look-none">
                It raised nothing from what it read. That isn't a sign the change is right: the diff
                above is yours to check.
              </p>
            ) : (
              kinds.map(({ kind, heading }) => {
                const findings = look.findings.filter((f) => f.kind === kind);
                if (findings.length === 0) return null;
                return (
                  <div key={kind} class="second-look-kind" data-kind={kind}>
                    <h4>{heading}</h4>
                    <ul>
                      {findings.map((finding, i) => (
                        <li key={i} class="finding">
                          <p class="finding-says">
                            <span class="finding-on">On {finding.lines.map(on).join(", ")}:</span>{" "}
                            {finding.says}
                          </p>
                          {finding.evidence.map((e, j) => (
                            <figure key={j} class="quote-from" data-found="true">
                              <figcaption>
                                {e.id === null ? (
                                  `Word for word from what ${on(e.line)} would write`
                                ) : (
                                  <>
                                    Word for word from <AnswerChip id={e.id} />
                                    {e.outside && " · outside this workstream"}
                                  </>
                                )}
                              </figcaption>
                              <blockquote>
                                <p>{e.quote}</p>
                              </blockquote>
                            </figure>
                          ))}
                          {finding.changes.length > 0 && (
                            <ul class="suggested">
                              {finding.changes.map((place) => {
                                const change = look.companions[place];
                                if (!change) return null;
                                return (
                                  <li key={place}>
                                    <span class="suggested-change">{change.sentence}</span>
                                    {change.added ? (
                                      <span class="suggested-added">Added to this change set</span>
                                    ) : (
                                      <button
                                        type="button"
                                        class="quiet-action"
                                        disabled={busy}
                                        onClick={() => props.onAdd(place)}
                                      >
                                        Add to this change set
                                      </button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </>
        )}
      </section>
    </ChipsContext.Provider>
  );
}
