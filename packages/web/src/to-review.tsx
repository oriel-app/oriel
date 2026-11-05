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
    const sets = ids.flatMap((id): [Element, string][] => {
      const set = document.getElementById(changeSetAnchor(id));
      return set ? [[set, id]] : [];
    });
    const seen = new Map<string, { view: Side | "shown" | "gone"; upTo: boolean }>();
    const settle = () => {
      const sides: Record<string, Side> = {};
      for (const [id, { view, upTo }] of seen)
        if (view !== "shown") sides[id] = view === "gone" ? (upTo ? "above" : "below") : view;
      setOut(sides);
    };
    const mark = (id: string, change: Partial<{ view: Side | "shown" | "gone"; upTo: boolean }>) =>
      seen.set(id, { view: "gone", upTo: false, ...seen.get(id), ...change });
    // In the window with everything above it: a jump past the window, as
    // with End, crosses it, so nothing is left on the wrong side.
    const upTo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = sets.find(([set]) => set === entry.target)?.[1];
          if (id !== undefined) mark(id, { upTo: entry.isIntersecting });
        }
        settle();
      },
      { rootMargin: "1000000px 0px 0px 0px" },
    );
    for (const [set] of sets) upTo.observe(set);
    // In the window above the composer, mostly: one observer each, whose
    // threshold is where half of it, or half the screen, shows. Measured
    // again as the sets, the composer or the window change size.
    const composer = document.querySelector(".thread .composer");
    let views: IntersectionObserver[] = [];
    const measure = () => {
      for (const view of views) view.disconnect();
      const hidden = composer ? Math.max(0, innerHeight - composer.getBoundingClientRect().top) : 0;
      views = sets.map(([set, id]) => {
        const half = Math.min(
          0.5,
          innerHeight / (2 * Math.max(1, set.getBoundingClientRect().height)),
        );
        const view = new IntersectionObserver(
          ([entry]) => {
            if (!entry) return;
            const { boundingClientRect: box, intersectionRect: shows, rootBounds } = entry;
            const mostly = shows.height * 2 >= Math.min(box.height, innerHeight);
            const side: Side = box.top < (rootBounds?.top ?? 0) ? "above" : "below";
            mark(id, { view: !entry.isIntersecting ? "gone" : mostly ? "shown" : side });
            settle();
          },
          { rootMargin: `0px 0px -${hidden}px 0px`, threshold: [0, half] },
        );
        view.observe(set);
        return view;
      });
    };
    measure();
    const resized = new ResizeObserver(measure);
    for (const [set] of sets) resized.observe(set);
    if (composer) resized.observe(composer);
    addEventListener("resize", measure);
    return () => {
      upTo.disconnect();
      resized.disconnect();
      removeEventListener("resize", measure);
      for (const view of views) view.disconnect();
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
