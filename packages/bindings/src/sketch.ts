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
