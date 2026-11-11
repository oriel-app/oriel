// While a change set awaiting review is mostly above or below what's on
// screen, a pill over the thread's composer says so, and goes to the nearest
// one (OA-260). Mostly: less than half of it shows, or of the room above the
// composer when it's taller (`placed`, OA-272), and what's behind the
// composer doesn't show. Where each one is comes from IntersectionObservers,
// never from the page's scroll. With none out of view, there is no pill.
import { useEffect, useState } from "preact/hooks";
import { placed, watching } from "./change-set.ts";
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
    // Each one's place, as of the frame it was seen in.
    const seen = new Map<string, { place: Side | "shown"; time: number }>();
    // Two observers each, from `watching`, so that every change of where
    // one is calls back: a jump that crosses no half too, as with End.
    // Measured again as the sets, the composer or the window change size;
    // an entry an observer let go of had queued is older, and goes unread.
    const composer = document.querySelector(".thread .composer");
    let views: IntersectionObserver[] = [];
    const measure = () => {
      for (const view of views) view.disconnect();
      const hidden = composer ? Math.max(0, innerHeight - composer.getBoundingClientRect().top) : 0;
      const room = innerHeight - hidden;
      views = sets.flatMap(([set, id]) =>
        watching(set.getBoundingClientRect().height, room).map(({ top, thresholds }) => {
          const view = new IntersectionObserver(
            (entries) => {
              const entry = entries.at(-1);
              if (!entry || entry.time < (seen.get(id)?.time ?? -1)) return;
              seen.set(id, { place: placed(entry.boundingClientRect, room), time: entry.time });
              const sides: Record<string, Side> = {};
              for (const [key, { place }] of seen) if (place !== "shown") sides[key] = place;
              setOut(sides);
            },
            { rootMargin: `${-top}px 0px -${hidden}px 0px`, threshold: thresholds },
          );
          view.observe(set);
          return view;
        }),
      );
    };
    measure();
    const resized = new ResizeObserver(measure);
    for (const [set] of sets) resized.observe(set);
    if (composer) resized.observe(composer);
    addEventListener("resize", measure);
    return () => {
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
  // In the column over the composer (`.composer-pills`).
  return (
    <>
      {pill("above", above, above.at(-1))}
      {pill("below", below, below[0])}
    </>
  );
}
