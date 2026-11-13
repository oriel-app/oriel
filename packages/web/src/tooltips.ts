type Box = { top: number; bottom: number; left: number; right: number };
type Size = { width: number; height: number };

const gap = 6;
const edge = 8;

export function placeTooltip(
  control: Box,
  tip: Size,
  window: Size,
): { top: number; left: number; side: "above" | "below" } {
  const above = control.top - gap - tip.height;
  const centred = (control.left + control.right) / 2 - tip.width / 2;
  const left = Math.max(edge, Math.min(centred, window.width - tip.width - edge));
  return above >= edge
    ? { top: above, left, side: "above" }
    : { top: control.bottom + gap, left, side: "below" };
}

export const repeatsName = (text: string, name: string | null): boolean =>
  name !== null && squash(name) === squash(text);

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
