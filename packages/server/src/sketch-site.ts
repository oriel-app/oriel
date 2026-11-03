// The sketch origin (decision 0033): a second listener of Oriel's server, on
// its own loopback port, that serves only `GET /sketches/<thread>/<sketch>`.
// Its document is Oriel's, with no script: one sandboxed frame, with no
// tokens, whose `srcdoc` holds Oriel's theme sheet and then the agent's
// text, checked again as it is served, so a stored sketch meets today's
// check. The document's policy, set by a header the agent can't touch, stops
// every fetch, and a `srcdoc` document takes its parent's policy. Neither
// frame gets a sandbox token.
//
// It answers only requests that name it in Host (guard.ts). In the desktop
// app it also wants the launch secret every route but a review link's wants
// (decision 0036): cookies are scoped by host, not port, and both loopback
// ports are one site, so the window's cookie comes with the frame's request.
// Nothing in either frame can read or send it on: no script runs, and the
// inner frame has an opaque origin, so a request from it would be
// cross-site, if the policy let one out at all.
import { checkSketch, isUlid, type Sketch, type Ulid } from "@oriel/core";
import type { TextSize } from "@oriel/web/view";
import { sketchSheet } from "@oriel/web/themes";
import { hasLaunchSecret, ownHosts, refusal } from "./guard.ts";
import type { Reply, Request } from "./site.ts";

export type SketchSite = {
  // This listener's port, which Host must name.
  port: number;
  // The window's port: only its pages may frame a sketch.
  framedBy: number;
  sketch(thread: Ulid, sketch: Ulid): Sketch | null;
  // Oriel's sheet for the frame, in the person's theme and text size.
  sheet(): string;
  // In the desktop app, the launch secret and the cookie that carries it,
  // which every request must hold, as the window's own do (decision 0036).
  launch?: { cookie: string; secret: string };
};

// The plain look a sketch that names no token still gets, in the theme's
// neutral tokens: the body, headings, tables, buttons and inputs. Never the
// accent, a state or any of Oriel's own component styles.
const plainLook = `body {
  margin: 0;
  padding: var(--space-3);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--text-md);
  font-weight: var(--weight-regular);
  line-height: var(--leading);
}
h1, h2, h3, h4, h5, h6 {
  margin: var(--space-4) 0 var(--space-2);
  font-family: var(--font-heading);
  font-weight: var(--weight-strong);
  line-height: var(--leading-tight);
}
h1 { font-size: var(--text-xl); }
h2 { font-size: var(--text-lg); }
h3, h4, h5, h6 { font-size: var(--text-md); }
p, ul, ol, dl, table, figure, blockquote, pre, fieldset { margin: 0 0 var(--space-3); }
small, figcaption, caption { color: var(--text-muted); font-size: var(--text-sm); }
code, pre, kbd, samp { font-family: var(--font-mono); font-size: var(--text-sm); }
pre { padding: var(--space-2); background: var(--surface-sunk); border-radius: var(--radius-sm); overflow: auto; }
hr { border: 0; border-top: 1px solid var(--line); }
table { border-collapse: collapse; }
th, td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); text-align: start; vertical-align: top; }
th { color: var(--text-muted); font-weight: var(--weight-medium); border-bottom-color: var(--line-strong); }
button, input, select, textarea {
  padding: var(--space-1) var(--space-2);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  font: inherit;
}
`;

// The frame's sheet: `theme`'s neutral tokens and `textSize`'s root size,
// built from window.css's own rules, then the plain look.
export const sketchStyle = (css: string, theme: string, textSize: TextSize): string =>
  `${sketchSheet(css, theme, textSize)}${plainLook}`;

// The outer document's policy (decision 0033): no fetch of any kind and no
// navigation of the inner frame; inline styles, with no URL that can load;
// images written inline; a second wall behind the check; only Oriel's window
// frames it; and sandboxed even when opened on its own.
export const sketchPolicy = (framedBy: number): string =>
  [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ownHosts(framedBy)
      .map((host) => `http://${host}`)
      .join(" ")}`,
    "sandbox",
  ].join("; ");

const attribute = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

// The outer document, from constants and the checked text alone.
export const sketchDocument = (sheet: string, html: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    '<meta charset="utf-8">',
    "<title>A sketch by the agent</title>",
    "<style>html, body { margin: 0; height: 100%; } iframe { display: block; border: 0; width: 100%; height: 100%; }</style>",
    `<iframe sandbox title="A sketch by the agent" srcdoc="${attribute(`<!doctype html><html lang="en"><style>${sheet}</style>${html}`)}"></iframe>`,
    "",
  ].join("\n");

const sketchPath = /^\/sketches\/([^/]+)\/([^/]+)$/;

export function sketchHandler(site: SketchSite): (request: Request) => Promise<Reply> {
  const headers = {
    "cache-control": "no-store",
    "content-security-policy": sketchPolicy(site.framedBy),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const reply = (status: number, type: string, body: string, extra = {}): Reply => ({
    status,
    headers: { ...headers, "content-type": type, ...extra },
    body,
  });
  const plain = (status: number, message: string, extra = {}) =>
    reply(status, "text/plain; charset=utf-8", `${message}\n`, extra);
  return async (request) => {
    const refused = refusal(request.method, request.headers, site.port);
    if (refused !== null) return plain(403, refused);
    const { launch } = site;
    if (launch && !hasLaunchSecret(request.headers.cookie, launch.cookie, launch.secret))
      return plain(403, "this server answers only the Oriel app that started it");
    if (request.method !== "GET" && request.method !== "HEAD")
      return plain(405, "method not allowed", { allow: "GET, HEAD" });
    const path = URL.parse(request.url, "http://localhost")?.pathname ?? "";
    const [, thread, id] = sketchPath.exec(path) ?? [];
    if (thread === undefined || id === undefined || !isUlid(thread) || !isUlid(id))
      return plain(404, "not found");
    const sketch = site.sketch(thread, id);
    if (!sketch) return plain(404, "not found");
    if (!checkSketch(sketch.html).ok)
      return plain(410, "This sketch uses markup a sketch can't use any more.");
    return reply(200, "text/html; charset=utf-8", sketchDocument(site.sheet(), sketch.html));
  };
}
