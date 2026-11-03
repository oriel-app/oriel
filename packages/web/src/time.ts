// How the window writes a time, as Settings › General picks (decision 0046):
// relative, "3 min ago" or "in 2 h", or absolute, as each place writes a
// date. A review link's page always has the default.
import type { TimeFormat } from "./view.ts";

export const defaultTimeFormat: TimeFormat = "relative";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

// An instant an hour, a day or a month from `now`, in words. Past a month,
// the date.
export function relative(instant: string, now: number): string {
  const at = Date.parse(instant);
  if (Number.isNaN(at)) return instant;
  const gap = at - now;
  const ahead = gap > 0;
  const span = Math.abs(gap);
  const said = (count: number, unit: string) =>
    ahead ? `in ${count} ${unit}` : `${count} ${unit} ago`;
  if (span < minute) return ahead ? "in a moment" : "just now";
  if (span < hour) return said(Math.floor(span / minute), "min");
  if (span < day) return said(Math.floor(span / hour), "h");
  const days = Math.floor(span / day);
  if (days === 1) return ahead ? "tomorrow" : "yesterday";
  if (days < 31) return said(days, "days");
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// An instant as a short date and time, in the reader's zone.
export function when(instant: string): string {
  return new Date(instant).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// An instant in `format`: relative, or as `absolute` writes it. A time
// that has happened is never written as one to come, as a clock behind the
// server's would; only one `ahead`, such as when a limit resets, is.
export function stamp(
  instant: string,
  format: TimeFormat,
  now: number,
  absolute: (instant: string) => string = when,
  ahead = false,
): string {
  if (format === "absolute") return absolute(instant);
  const at = Date.parse(instant);
  return relative(
    ahead || Number.isNaN(at) ? instant : new Date(Math.min(at, now)).toISOString(),
    now,
  );
}
