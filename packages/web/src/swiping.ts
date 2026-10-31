// How far a swiped row moves, and where it comes to rest. A row pulled left
// follows the pull to its first stop, which shows its first action; past it,
// it gives way only half as fast up to its last stop, which shows the rest,
// and barely at all beyond. Let go, and it rests at the nearest of closed or
// a stop. Pure, so it is tested without a DOM; swipe.tsx feeds it.

// The offsets, in pixels, at which each action is in full view, ascending.
export type Stops = readonly number[];

// Past the first stop, and past the last.
const firm = 0.5;
const stiff = 0.15;

// The row's offset for a pull of `pulled` pixels to the left.
export function resisted(pulled: number, stops: Stops): number {
  const first = stops[0] ?? 0;
  const last = stops.at(-1) ?? 0;
  if (pulled <= first) return Math.max(0, pulled);
  const firmEnd = first + (last - first) / firm;
  if (pulled <= firmEnd) return first + (pulled - first) * firm;
  return last + (pulled - firmEnd) * stiff;
}

// The pull that puts the row at `offset`: where a new swipe picks it up.
export function pullFor(offset: number, stops: Stops): number {
  const first = stops[0] ?? 0;
  const last = stops.at(-1) ?? 0;
  if (offset <= first) return Math.max(0, offset);
  if (offset <= last) return first + (offset - first) / firm;
  return first + (last - first) / firm + (offset - last) / stiff;
}

// Where a row let go at `offset` rests: 0 (closed) or one of the stops.
export function settle(offset: number, stops: Stops): number {
  return [0, ...stops].reduce((best, stop) =>
    Math.abs(stop - offset) < Math.abs(best - offset) ? stop : best,
  );
}

// How many of the actions a row resting at `offset` shows.
export const shown = (offset: number, stops: Stops): number =>
  stops.filter((stop) => offset >= stop).length;
