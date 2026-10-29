// Error text from the guest, made readable for the agent. The text is the
// guest's, so it is clipped first and every pattern here stays linear in it.

// Keep it to a readable size.
export const clip = (text: string, max = 4_000) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

// A frame in the script reads "eval at run (<entry>:120:22), <anonymous>:7:9".
// Its line, less `lineOffset`, is the script's, and becomes `script.ts:4:9`.
// Positions in the entry module (the shim) become `<bindings>`, the run's
// directory `<sandbox>`, and terminal colors go.
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

// ANSI color codes: ESC, "[", parameters, "m".
const colors = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
