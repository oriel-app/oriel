// The text is the guest's, so it is clipped first and every pattern here stays linear in it.

export const clip = (text: string, max = 4_000) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export function sanitize(
  text: string,
  entry: { url: string; path: string; dir: string },
  lineOffset: number,
): string {
  const inEntry = new RegExp(`(?:${escape(entry.url)}|${escape(entry.path)})(?::\\d+){0,2}`, "g");
  return (
    clip(text)
      .replace(colors, "")
      // No lazy `[^\n]*?` here: on a line of repeated "eval at " it would scan
      // to the end from every match, quadratic in the guest's text.
      .replace(
        /eval at [^\n,]*, <anonymous>:(\d+):(\d+)/g,
        (_, line: string, column: string) => `script.ts:${Number(line) - lineOffset}:${column}`,
      )
      .replace(/\bat eval \((script\.ts:\d+:\d+)\)/g, "at $1")
      .replace(inEntry, "<bindings>")
      .replaceAll(entry.dir, "<sandbox>")
  );
}

const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
