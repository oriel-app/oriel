// `sketch()`: the one binding for sketches (decision 0033). The agent hands
// Oriel HTML and CSS and one of three heights; the turn checks the text
// (core's `checkSketch`) and shows it under the reply in a sandboxed frame,
// or refuses with what to change, as a tool result, rather than failing the
// run. Both arguments are checked there, so a wrong one is refused too.
import { param, read, unknown } from "@oriel/core";
import type { Fn, Host } from "./fn.ts";

export const sketchFn: Fn = {
  space: null,
  outsideRegion: false,
  ...read({
    name: "sketch",
    doc: "HTML and CSS, no script or link, when no block can draw it.",
    params: [param("html", "string", unknown), param("h", "240 | 400 | 640", unknown)],
    returns: "string",
    run: async ([html, height], host: Host) => host.sketch(html, height),
  }),
};
