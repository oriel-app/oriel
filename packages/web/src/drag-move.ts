// What moves is held here, beside the drag's own type, since a page can't read a drag's data
// until the drop.
import { useEffect, useState } from "preact/hooks";
import { drop, lift } from "./drag-card.ts";
import type { Carried } from "./moving.ts";

const itemType = "application/x-oriel-item";

let carried: Carried | null = null;

const ours = (event: DragEvent): Carried | null =>
  carried !== null && event.dataTransfer?.types.includes(itemType) ? carried : null;

// The whole page takes our drop, so the system never refuses it: a refused drop slides the
// drag image back first, on macOS for most of a second, and only then ends the drag.
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

export function dragMove(item: Carried) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      if (!event.dataTransfer) return;
      carried = item;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(itemType, item.id);
      document.addEventListener("dragover", anywhere);
      document.addEventListener("drop", nowhere);
      const face =
        item.kind === "item"
          ? { key: item.key, title: item.title ?? "" }
          : { key: "", title: item.title ?? "New thread" };
      lift(event, event.currentTarget as HTMLElement, face);
    },
    // dropEffect is "none" both for a drop nowhere, whose card went back already, and for Escape.
    onDragEnd: (event: DragEvent) => {
      settled();
      drop(event.dataTransfer?.dropEffect === "none" ? "back" : "dropped");
    },
  };
}

export function useMoveDrop(
  takes: (item: Carried) => boolean,
  onDrop: (item: Carried, at: { x: number; y: number }) => void,
) {
  const [over, setOver] = useState(false);
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
