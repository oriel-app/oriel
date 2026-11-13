export type Stops = readonly number[];

const firm = 0.5;
const stiff = 0.15;

export function resisted(pulled: number, stops: Stops): number {
  const first = stops[0] ?? 0;
  const last = stops.at(-1) ?? 0;
  if (pulled <= first) return Math.max(0, pulled);
  const firmEnd = first + (last - first) / firm;
  if (pulled <= firmEnd) return first + (pulled - first) * firm;
  return last + (pulled - firmEnd) * stiff;
}

export function pullFor(offset: number, stops: Stops): number {
  const first = stops[0] ?? 0;
  const last = stops.at(-1) ?? 0;
  if (offset <= first) return Math.max(0, offset);
  if (offset <= last) return first + (offset - first) / firm;
  return first + (last - first) / firm + (offset - last) / stiff;
}

export function settle(offset: number, stops: Stops): number {
  return [0, ...stops].reduce((best, stop) =>
    Math.abs(stop - offset) < Math.abs(best - offset) ? stop : best,
  );
}

export const shown = (offset: number, stops: Stops): number =>
  stops.filter((stop) => offset >= stop).length;
