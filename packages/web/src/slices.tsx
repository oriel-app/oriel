// Release slices under the agent's reply (the scope-lab spike): the agent's
// two or three proposed cuts of the workstream, each with the outcomes it
// keeps and loses in the agent's words and what the agent read items need,
// which the person toggles item by item. Every figure is Oriel's, from the
// index as it is now: each toggle asks the server again, which calls no
// model. Points are what was recorded on items, never time. A cut becomes a
// change set the person approves as any other.
import { useRef, useState } from "preact/hooks";
import { AnswerChip, Markdown } from "./parts.tsx";
import type { SliceFiguresView, SliceSideView, SlicesView } from "./view.ts";

// A change set holds 20 changes: a new epic and 19 moves (core's
// `maxCutMoves`, which the server checks again).
const maxCutMoves = 19;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Side({ label, side, tone }: { label: string; side: SliceSideView; tone: string }) {
  return (
    <div class="slice-side" data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        <strong>{plural(side.items, "item")}</strong>
        <span>{plural(side.points, "recorded point")}</span>
        {side.unestimated > 0 && (
          <span class="slice-missing">{side.unestimated} with no estimate</span>
        )}
      </dd>
    </div>
  );
}

// Where a need comes from: the items the agent read it in, or its guess.
function Reading({ from }: { from: readonly string[] }) {
  if (!from.length) return <span class="slice-whose">the agent's guess; no item says so</span>;
  return (
    <span class="slice-whose">
      the agent's reading of{" "}
      {from.map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          <AnswerChip id={id} />
        </span>
      ))}
    </span>
  );
}

const isId = (on: string) => /^[a-z]{1,20}(\.[0-9]{1,4})?:\S+$/.test(on);
const On = ({ on }: { on: string }) => (isId(on) ? <AnswerChip id={on} /> : <q>{on}</q>);

export function SlicesFigure(props: {
  threadId: string;
  slices: SlicesView;
  sites: ReadonlySet<string>;
}) {
  const { threadId, slices: view, sites } = props;
  const [picked, setPicked] = useState(0);
  // The person's cut of each slice, as deferred items, from the agent's.
  const [cuts, setCuts] = useState(() => view.slices.map((s) => new Set(s.defer)));
  const [figures, setFigures] = useState<SliceFiguresView[]>(() =>
    view.slices.map((s) => s.figures),
  );
  const [later, setLater] = useState(view.later?.name ?? "");
  const [state, setState] = useState<"idle" | "making" | "made" | { problem: string }>("idle");
  // Only the latest toggle's answer is shown, whatever order answers come in;
  // until it comes, or if it fails, the figures say they're out of date.
  const asked = useRef(0);
  const [pending, setPending] = useState<"computing" | "failed" | null>(null);
  const slice = view.slices[picked];
  const cut = cuts[picked];
  const shown = figures[picked];
  if (!slice || !cut || !shown) return null;
  const base = `/api/threads/${threadId}/slices/${view.id}`;
  const toggled = cut.size !== slice.defer.length || slice.defer.some((id) => !cut.has(id));

  const refigure = async (index: number, next: Set<string>) => {
    const ask = ++asked.current;
    setPending("computing");
    const query = new URLSearchParams({ defer: [...next].join(",") });
    const response = await fetch(`${base}/figures?${query}`).catch(() => null);
    if (ask !== asked.current) return;
    if (!response?.ok) return setPending("failed");
    // Our own server's reply, in the shape view.ts declares for both sides.
    const computed = (await response.json()) as SliceFiguresView;
    if (ask !== asked.current) return;
    setFigures((all) => all.map((f, i) => (i === index ? computed : f)));
    setPending(null);
  };
  const toggle = (id: string) => {
    const next = new Set(cut);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCuts((all) => all.map((c, i) => (i === picked ? next : c)));
    void refigure(picked, next);
  };
  const reset = () => {
    const next = new Set(slice.defer);
    setCuts((all) => all.map((c, i) => (i === picked ? next : c)));
    void refigure(picked, next);
  };
  const make = async () => {
    setState("making");
    const response = await fetch(`${base}/cut`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defer: [...cut], later, toggled }),
    }).catch(() => null);
    if (response?.ok) return setState("made");
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setState({ problem: body?.error ?? "Oriel couldn't make the change set." });
  };

  const stale = view.stale;
  const staleIds = stale
    ? [...new Set([...stale.changed, ...stale.gone, ...stale.added, ...stale.removed])]
    : [];
  // What the cut moves: deferred items a later epic can take.
  const moving = view.items.filter((item) => item.movable && cut.has(item.id)).length;
  const staying = cut.size - moving;
  return (
    <figure class="answer-slices">
      <header class="slices-head">
        <p class="slices-title">Release slices</p>
        <div class="slices-tabs" role="tablist" aria-label="Proposed slices">
          {view.slices.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === picked}
              onClick={() => setPicked(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </header>
      {stale && (
        <p class="slices-stale" role="note">
          Stale: {plural(staleIds.length, "item")} changed since the agent proposed these (
          {staleIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <AnswerChip id={id} />
            </span>
          ))}
          ). Oriel's figures are current; the agent's words may not be. Ask again to refresh them.
        </p>
      )}
      {pending && (
        <p class="slices-pending" role="status">
          {pending === "computing"
            ? "Computing…"
            : "Oriel couldn't compute these figures for your change; they're for the cut before it."}
        </p>
      )}
      <dl class="slices-figures" aria-live="polite" data-pending={pending ?? undefined}>
        <Side label="Keeps" side={shown.kept} tone="kept" />
        <Side label="Defers" side={shown.deferred} tone="deferred" />
        <Side label="Done already" side={shown.done} tone="done" />
      </dl>
      {shown.broken.length > 0 && (
        <ul class="slices-broken">
          {shown.broken.map((b, i) => (
            <li key={i}>
              Keeps <AnswerChip id={b.item} />, which needs <AnswerChip id={b.deferred} />, deferred
              here: <Reading from={b.from} />
            </li>
          ))}
        </ul>
      )}
      <div class="slices-outcomes">
        <section>
          <h4>Outcomes kept</h4>
          <ul>
            {slice.keeps.map((o, i) => (
              <li key={i}>
                <Markdown text={o} linksTo={sites} answer />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Outcomes lost</h4>
          {slice.loses.length ? (
            <ul>
              {slice.loses.map((o, i) => (
                <li key={i}>
                  <Markdown text={o} linksTo={sites} answer />
                </li>
              ))}
            </ul>
          ) : (
            <p class="slices-none">None, by the agent's reading</p>
          )}
        </section>
      </div>
      <div class="slices-items-head">
        <h4>Items</h4>
        {toggled && (
          <button type="button" class="quiet-action" onClick={reset}>
            Back to the agent's slice
          </button>
        )}
      </div>
      <ul class="slices-items">
        {view.items.map((item) => {
          const deferred = cut.has(item.id);
          return (
            <li
              key={item.id}
              data-done={item.done || undefined}
              data-deferred={deferred || undefined}
              data-gone={item.gone || undefined}
            >
              <label>
                <input
                  type="checkbox"
                  checked={!item.done && !deferred}
                  disabled={item.done || item.gone || state === "made"}
                  onChange={() => toggle(item.id)}
                />
                <span class="slices-verb">
                  {item.done ? "Done" : item.gone ? "Gone" : deferred ? "Defer" : "Keep"}
                </span>
              </label>
              <AnswerChip id={item.id} />
              <span class="slices-estimate" data-missing={item.estimate === null || undefined}>
                {item.estimate === null ? "no estimate" : plural(item.estimate, "pt")}
              </span>
            </li>
          );
        })}
      </ul>
      {view.needs.length > 0 && (
        <details class="slices-needs">
          <summary>What the agent read items need ({view.needs.length})</summary>
          <ul>
            {view.needs.map((n, i) => (
              <li key={i}>
                <AnswerChip id={n.item} /> needs <On on={n.on} />: <Reading from={n.from} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.later && (
        <div class="slices-cut">
          {state === "made" ? (
            <p>Made a change set below. Nothing changes in the source until you approve it.</p>
          ) : (
            <>
              <label>
                Move {plural(moving, "deferred item")} to a new epic
                {staying > 0 && ` (${staying} can't move and stay where they are)`}
                <input
                  type="text"
                  value={later}
                  maxLength={120}
                  onInput={(e) => setLater(e.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                class="button primary"
                disabled={
                  state === "making" ||
                  pending !== null ||
                  moving === 0 ||
                  moving > maxCutMoves ||
                  later.trim() === ""
                }
                onClick={() => void make()}
              >
                Make a change set
              </button>
              {moving > maxCutMoves && (
                <p class="slices-problem">
                  A change set moves at most {maxCutMoves} items; defer fewer, or cut twice.
                </p>
              )}
              {typeof state === "object" && <p class="slices-problem">{state.problem}</p>}
            </>
          )}
        </div>
      )}
      <figcaption>
        Slices and their words are the agent's. Every figure is computed by Oriel from the index,
        again on each change, with no model call. Points are what was recorded on items, not time.
      </figcaption>
    </figure>
  );
}
