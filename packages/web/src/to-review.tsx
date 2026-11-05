// While a change set awaiting review is mostly above or below what's on
// screen, a pill over the thread's composer says so, and goes to the nearest
// one (OA-260). Mostly: less than half of it shows, or of the screen when
// it's taller, and what's behind the composer doesn't show. Where each one
// is comes from IntersectionObservers, never from the page's scroll. With
// none out of view, there is no pill.
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
    // Two observers tell where each is: in the window above the composer,
    // and in the window with everything above it. A jump past the window, as
    // with End, crosses the second, so nothing is left on the wrong side.
    const composer = document.querySelector(".thread .composer");
    const hidden = composer ? Math.max(0, innerHeight - composer.getBoundingClientRect().top) : 0;
    const seen = new Map<string, { view: Side | "shown" | "gone"; upTo: boolean }>();
    const settle = () => {
      const sides: Record<string, Side> = {};
      for (const [id, { view, upTo }] of seen)
        if (view !== "shown") sides[id] = view === "gone" ? (upTo ? "above" : "below") : view;
      setOut(sides);
    };
    const at = (entry: IntersectionObserverEntry) =>
      seen.get(of.get(entry.target) ?? "") ?? { view: "gone" as const, upTo: false };
    const steps = Array.from({ length: 21 }, (_, i) => i / 20);
    const view = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = of.get(entry.target);
          if (id === undefined) continue;
          const { boundingClientRect: box, intersectionRect: shows, rootBounds } = entry;
          const room = rootBounds?.height ?? innerHeight;
          const mostly = shows.height * 2 >= Math.min(box.height, room);
          const side: Side = box.top < (rootBounds?.top ?? 0) ? "above" : "below";
          seen.set(id, {
            ...at(entry),
            view: !entry.isIntersecting ? "gone" : mostly ? "shown" : side,
          });
        }
        settle();
      },
      { rootMargin: `0px 0px -${hidden}px 0px`, threshold: steps },
    );
    const upTo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = of.get(entry.target);
          if (id !== undefined) seen.set(id, { ...at(entry), upTo: entry.isIntersecting });
        }
        settle();
      },
      { rootMargin: "1000000px 0px 0px 0px" },
    );
    const observers = [view, upTo];
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
