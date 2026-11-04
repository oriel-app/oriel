// A sketch (decision 0033): HTML and CSS the agent writes, shown under its
// answer in a sandboxed frame that reaches nothing. The frames are the wall;
// the check here refuses, never rewrites, so the frames meet only text that
// can't navigate. It doesn't parse. A browser makes an element only from a
// `<name` or `</name` token, or implies one (`html`, `head`, `body`,
// `tbody`, `tr`), so every `<` in the text, in a comment or a `<style>` too,
// must open an allowed element, close one or open a comment. Every `href`,
// `xlink:href` included, in any case, must be written `href="#name"`,
// pointing inside the sketch. The check runs when the agent calls
// `sketch()`, and again whenever the frame is served.
import { isUlid, type Ulid } from "./ids.ts";
import { literal, number, object, refine, string, union, type Validator } from "./validate.ts";

// Elements for text, lists, tables, sections, form controls outside a form,
// `img` and `details`, and SVG's shapes, text, gradients, markers and `use`,
// by their names in lower case. Nothing here can navigate, hold a frame, run
// anything or load media: an `img` draws as a still image, and the frame's
// policy stops every fetch.
export const sketchElements: ReadonlySet<string> = new Set([
  // The document and its text.
  ..."html head body title style div span p br hr h1 h2 h3 h4 h5 h6 header footer main section article aside figure figcaption blockquote q cite abbr dfn time code pre kbd samp var mark strong em b i u s small sub sup del ins wbr address".split(
    " ",
  ),
  // Lists and tables.
  ..."ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td".split(" "),
  // Form controls, which do nothing outside a form; and images and details.
  ..."button input label select option optgroup textarea fieldset legend progress meter output img details summary".split(
    " ",
  ),
  // SVG.
  ..."svg g defs symbol use path rect circle ellipse line polyline polygon text tspan desc lineargradient radialgradient stop marker pattern clippath".split(
    " ",
  ),
]);

// The heights a frame takes, in pixels; a taller sketch scrolls inside it.
export const sketchHeights = [240, 400, 640] as const;
export type SketchHeight = (typeof sketchHeights)[number];
export const isSketchHeight = (value: unknown): value is SketchHeight =>
  (sketchHeights as readonly unknown[]).includes(value);

// The most a sketch's text may be, in UTF-8 bytes, and the most an answer
// shows.
export const maxSketchBytes = 32 * 1024;
export const maxSketchesPerTurn = 2;

// Why a sketch was refused, for telemetry, which never records its text or
// the names refused: too big, too many, or something not allowed in it (an
// element, an `href` or a stray `<`). A call with no text or another height
// is `malformed`.
export const sketchRefusals = ["too-big", "too-many", "not-allowed", "malformed"] as const;
export type SketchRefusal = (typeof sketchRefusals)[number];

// The tokens a sketch's theme sheet sets (decisions 0033 and 0034): the
// neutral colours, the fonts, the text sizes, weights and leadings, the
// space scale and the radii. Never the accent, a state, `--del`, or a
// section, list or ask-bar token, so a sketch can't draw a copy of Approve.
export const sketchTokens = [
  "--bg",
  "--surface",
  "--surface-hover",
  "--surface-sunk",
  "--line",
  "--line-strong",
  "--text",
  "--text-muted",
  "--text-faint",
  "--font",
  "--font-mono",
  "--font-heading",
  "--text-xs",
  "--text-sm",
  "--text-md",
  "--text-lg",
  "--text-xl",
  "--weight-regular",
  "--weight-medium",
  "--weight-strong",
  "--leading-tight",
  "--leading",
  "--leading-prose",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-6",
  "--space-8",
  "--radius-sm",
  "--radius",
  "--radius-lg",
] as const;

// A sketch as Oriel checked it, stored with its turn.
export type Sketch = { id: Ulid; html: string; height: SketchHeight };

export const storedSketch: Validator<Sketch> = object({
  id: refine(string, isUlid, "expected a ULID"),
  html: string,
  height: refine(number, isSketchHeight, "expected 240, 400 or 640"),
});

export const sketchRefusal: Validator<SketchRefusal> = union(
  literal("too-big"),
  literal("too-many"),
  literal("not-allowed"),
  literal("malformed"),
);

// What a run's record and its log lines keep of a call's arguments: a
// sketch's HTML, which may repeat what the agent read, as its size in bytes,
// never its text.
// Slices (the scope-lab spike), whose outcomes may repeat what the agent
// read too, likewise.
export const recordedArgs = (fn: string, args: readonly unknown[]): unknown[] => {
  if ((fn !== "sketch" && fn !== "slices") || args.length === 0) return [...args];
  const [html, ...rest] = args;
  const text = typeof html === "string" ? html : (JSON.stringify(html) ?? "");
  return [{ bytes: new TextEncoder().encode(text).length }, ...rest];
};

export type SketchChecked = { ok: true } | { ok: false; reason: SketchRefusal; why: string };

// Lower case for ASCII letters only, as an HTML parser lowers a tag's name.
const lower = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// A tag's name runs from its first ASCII letter up to whitespace, `/` or
// `>`, as a browser's tokenizer reads it.
const tag = /<\/?([A-Za-z][^\t\n\f\r />]*)/y;
const href = /href/gi;
const local = /^href="#[A-Za-z][\w:.-]*"/i;

const listed = (names: readonly string[]) => names.map((name) => `<${name}>`).join(", ");

// Whether `html` may be shown as a sketch, and if not, what to change, in
// words the agent can act on.
export function checkSketch(html: string): SketchChecked {
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > maxSketchBytes)
    return {
      ok: false,
      reason: "too-big",
      why: `it is ${bytes} bytes; the most is ${maxSketchBytes}`,
    };
  const refused = new Set<string>();
  let stray = 0;
  for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at + 1)) {
    if (html.startsWith("<!--", at)) continue;
    tag.lastIndex = at;
    const name = tag.exec(html)?.[1];
    if (name === undefined) stray += 1;
    else if (!sketchElements.has(lower(name))) refused.add(name);
  }
  let hrefs = 0;
  for (const found of html.matchAll(href))
    if (!local.test(html.slice(found.index, found.index + 256))) hrefs += 1;
  const problems = [
    refused.size
      ? `${listed([...refused])} ${refused.size === 1 ? "isn't an element" : "aren't elements"} a sketch may use; it can't link, frame, run or load anything`
      : "",
    stray ? `write each < in text as &lt;` : "",
    hrefs ? `write every href as href="#name", pointing inside the sketch` : "",
  ].filter(Boolean);
  return problems.length
    ? { ok: false, reason: "not-allowed", why: problems.join("; ") }
    : { ok: true };
}
