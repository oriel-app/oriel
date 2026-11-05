// While a change set awaiting review is above or below what's on screen, a
// pill over the thread's composer says so, and goes to the nearest one
// (OA-260). Where each one is comes from an IntersectionObserver, never from
// the page's scroll. With none out of view, there is no pill.
import { useEffect, useState } from "preact/hooks";
import { plural } from "./parts.tsx";
import { changeSetAnchor } from "./route.ts";

type Side = "above" | "below";

// `ids`: the thread's change sets awaiting review, in the thread's order.
export function ToReview(props: { ids: readonly string[]; onShow(changeSetId: string): void }) {
  const { ids, onShow } = props;
  const [out, setOut] = useState<Readonly<Record<string, Side>>>({});
  const watched = ids.join();
  useEffect(() => {
    const of = new Map<Element, string>();
    for (const id of ids) {
      const set = document.getElementById(changeSetAnchor(id));
      if (set) of.set(set, id);
    }
    // Two crossings tell where each is: into the window, and into the
    // window with everything above it. A jump past the window, as with
    // End, crosses the second, so nothing is left on the wrong side.
    const seen = new Map<string, { inView: boolean; upTo: boolean }>();
    const watch = (key: "inView" | "upTo", rootMargin: string) =>
      new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = of.get(entry.target);
            if (id === undefined) continue;
            seen.set(id, {
              inView: false,
              upTo: false,
              ...seen.get(id),
              [key]: entry.isIntersecting,
            });
          }
          const sides: Record<string, Side> = {};
          for (const [id, { inView, upTo }] of seen)
            if (!inView) sides[id] = upTo ? "above" : "below";
          setOut(sides);
        },
        { rootMargin },
      );
    const observers = [watch("inView", "0px"), watch("upTo", "1000000px 0px 0px 0px")];
    for (const observer of observers) for (const set of of.keys()) observer.observe(set);
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [watched]);
  const above = ids.filter((id) => out[id] === "above");
  const below = ids.filter((id) => out[id] === "below");
  // The nearest: the last of those above, the first of those below.
  const pill = (side: Side, sets: string[], to: string | undefined) =>
    to !== undefined && (
      <button type="button" class="to-review-pill" onClick={() => onShow(to)}>
        <span aria-hidden="true">{side === "above" ? "↑" : "↓"}</span>
        {plural(sets.length, "change set")} to review {side}
      </button>
    );
  if (above.length === 0 && below.length === 0) return null;
  return (
    <div class="to-review">
      {pill("above", above, above.at(-1))}
      {pill("below", below, below[0])}
    </div>
  );
}
