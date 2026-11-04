// A change set's second look (the challenger spike), between its diff and
// its controls: the agent's reading of what else the change would make
// wrong, never a verdict. Nothing here approves, rejects or blocks, and
// nothing looks like a pass: no tick, no green, no score, and no summary
// line, since the agent writes none. What Oriel knows for itself (what the
// look read, which quotes it found word for word, what changed since) is
// said in Oriel's words; what the agent concluded is captioned as its own.
import { AnswerChip, ChipsContext, plural } from "./parts.tsx";
import type { DiffView, SecondLookView, ThreadView } from "./view.ts";

type Finding = SecondLookView["findings"][number];

// Each kind's heading, in the order shown.
const kinds: readonly { kind: Finding["kind"]; heading: string }[] = [
  { kind: "conflict", heading: "Disagrees with something decided" },
  { kind: "discussion", heading: "A discussion this affects" },
  { kind: "companion", heading: "May need to change with it" },
  { kind: "related", heading: "Worth a look" },
];

// What the look read, from its runs' records, never its words.
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
  onAgain(): void;
  onAdd(place: number): void;
}) {
  const { look, diff, busy } = props;
  const stale = look.stale.diff || look.stale.items.length > 0;
  const added = look.companions.some((c) => c.added);
  // Where a finding bears: the item its line changes, or its place.
  const on = (n: number) => diff?.lines[n - 1]?.target?.key ?? `change ${n}`;
  const again = (
    <button type="button" class="quiet-action" disabled={busy} onClick={props.onAgain}>
      Look again
    </button>
  );
  return (
    <ChipsContext.Provider value={props.view.chips}>
      <section class="second-look" data-state={look.state} aria-label="Second look">
        <header class="second-look-head">
          <h3>Second look</h3>
          <span class="second-look-by">
            The agent's reading of what else this could affect. Not a review: it can miss things,
            and it never approves.
          </span>
        </header>
        {look.state === "running" && (
          <p class="second-look-note" role="status">
            Reading what this change touches. Nothing waits for it.
          </p>
        )}
        {look.state === "failed" && (
          <p class="second-look-note">
            It didn't finish{look.error ? `: ${look.error}` : "."} {again}
          </p>
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
                    .{" "}
                  </>
                )}
                {again}
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
                                Word for word from <AnswerChip id={e.id} />
                                {e.outside && " · outside this workstream"}
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
