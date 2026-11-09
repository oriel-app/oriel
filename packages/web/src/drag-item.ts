// Dragging an item inside the window, to move it to another workstream
// (moving.ts): a row that can be dragged, and a place that takes the drop.
// The drag carries its own type, which no drop from outside Oriel has and
// the page's DropZone leaves alone, and the item rides beside it here, since
// a page can't read a drag's data until the drop.
import { useEffect, useState } from "preact/hooks";
import { drop, lift } from "./drag-card.ts";
import type { Carried } from "./moving.ts";

const itemType = "application/x-oriel-item";

let carried: Carried | null = null;

// Whether the drag over a place is an item's, and which.
const ours = (event: DragEvent): Carried | null =>
  carried !== null && event.dataTransfer?.types.includes(itemType) ? carried : null;

// While an item is dragged, the whole page takes its drop, so the system
// never refuses it: a refused drop slides the browser's picture back first,
// on macOS for most of a second, and only then ends the drag. A drop that
// no place took sends the card back at once.
const anywhere = (event: DragEvent) => {
  if (event.defaultPrevented || !ours(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
};
const nowhere = (event: DragEvent) => {
  if (event.defaultPrevented || !ours(event)) return;
  event.preventDefault();
  drop("back");
};
const settled = () => {
  carried = null;
  document.removeEventListener("dragover", anywhere);
  document.removeEventListener("drop", nowhere);
};

// The props that make a row draggable as `item`. The cursor says move, and
// the item rides on its card (drag-card.ts): set down where it's dropped,
// or back to its row from a drop nowhere.
export function dragItem(item: Carried) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      if (!event.dataTransfer) return;
      carried = item;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(itemType, item.id);
      document.addEventListener("dragover", anywhere);
      document.addEventListener("drop", nowhere);
      lift(event, event.currentTarget as HTMLElement, { key: item.key, title: item.title ?? "" });
    },
    // A drop nowhere sent the card back already; one Escape cancelled
    // still says "none".
    onDragEnd: (event: DragEvent) => {
      settled();
      drop(event.dataTransfer?.dropEffect === "none" ? "back" : "dropped");
    },
  };
}

// A place an item can be dropped on: `takes` says whether it takes this
// one, and `onDrop` gets it with where the pointer let go. `over`: an item
// it takes is over it now, to be drawn so. One it doesn't take isn't drawn,
// and its drop is a drop nowhere.
export function useItemDrop(
  takes: (item: Carried) => boolean,
  onDrop: (item: Carried, at: { x: number; y: number }) => void,
) {
  const [over, setOver] = useState(false);
  // A drag that ends anywhere, dropped or not, is over everywhere.
  useEffect(() => {
    if (!over) return;
    const ended = () => setOver(false);
    document.addEventListener("dragend", ended);
    document.addEventListener("drop", ended);
    return () => {
      document.removeEventListener("dragend", ended);
      document.removeEventListener("drop", ended);
    };
  }, [over]);
  const taken = (event: DragEvent) => {
    const item = ours(event);
    return item !== null && takes(item) ? item : null;
  };
  const entered = (event: DragEvent) => {
    if (!taken(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (!over) setOver(true);
  };
  return {
    over,
    props: {
      onDragEnter: entered,
      onDragOver: entered,
      onDragLeave: (event: DragEvent) => {
        const to = event.relatedTarget;
        if (to instanceof Node && (event.currentTarget as Node).contains(to)) return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        const item = taken(event);
        setOver(false);
        if (!item) return;
        event.preventDefault();
        settled();
        onDrop(item, { x: event.clientX, y: event.clientY });
      },
    },
  };
}
