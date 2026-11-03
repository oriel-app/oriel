// The sketch check (decision 0033): it refuses, never rewrites; every `<`
// opens an allowed element, closes one or opens a comment, and every href
// points inside the sketch. The probes are the loopback harness's attempts
// on the scan, and the elements it found can navigate, frame or load.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSketch, maxSketchBytes, sketchElements } from "./sketch.ts";

const why = (html: string) => {
  const checked = checkSketch(html);
  return checked.ok ? null : checked.why;
};

test("a sketch of text, tables, controls, an image and SVG passes", () => {
  const html = `<!-- a plan -->
<style>.lane { display: grid; gap: var(--space-2); } td > b { color: var(--text-muted); }</style>
<section class="lane"><h2>Release</h2><p>Ships Nov 9 &lt;ish&gt; &amp; then</p>
<table><thead><tr><th>Story</th></tr></thead><tbody><tr><td><b>SYN-26</b></td></tr></tbody></table>
<details open><summary>More</summary><ul><li>one</li></ul></details>
<label>Name <input value="x"></label><button>Approve</button><select><option>a</option></select>
<img alt="" src="data:image/png;base64,AAAA">
<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient>
<marker id="m"><path d="M0 0L9 5"/></marker><symbol id="s"><circle r="2"/></symbol></defs>
<use href="#s" x="2"/><use xlink:href="#s"/><rect fill="url(#g)" width="9" height="9"/>
<text x="1" y="9"><tspan>hi</tspan></text></svg></section>`;
  assert.deepEqual(checkSketch(html), { ok: true });
});

test("every element that can navigate, frame, run or load media is refused, in any case", () => {
  for (const name of [
    "a",
    "area",
    "iframe",
    "frame",
    "object",
    "embed",
    "form",
    "link",
    "meta",
    "base",
    "script",
    "noscript",
    "template",
    "picture",
    "video",
    "audio",
    "image",
    "feImage",
    "foreignObject",
  ]) {
    assert.equal(sketchElements.has(name.toLowerCase()), false, name);
    assert.match(why(`<${name}>`) ?? "", new RegExp(`<${name}> isn't an element`), name);
    assert.match(why(`<p></${name.toUpperCase()}></p>`) ?? "", /isn't an element/, name);
  }
});

test("the harness's attempts on the scan are all refused", () => {
  const sink = "http://probe.exfil.test:9/x";
  for (const html of [
    `<IFRAME SRC="${sink}"></IFRAME>`,
    `<iframe/src="${sink}"></iframe>`,
    `<iframe\fsrc="${sink}"></iframe>`,
    `<svg><style><iframe src="${sink}"></iframe></style></svg>`,
    `<!-- <iframe src="${sink}"> -->`,
    `<noscript><iframe src="${sink}"></iframe></noscript>`,
    `<image src="${sink}">`,
    `<a id="go" href="javascript:fetch('${sink}')">go</a>`,
    // A name the browser lowers only in ASCII, so it is no allowed element.
    `<ſvg>`,
  ])
    assert.ok(why(html), html);
});

test("text that only looks like markup passes: an escaped tag stays text", () => {
  assert.deepEqual(checkSketch(`&lt;iframe src="x"&gt; and a &lt; b`), { ok: true });
});

test("a stray < is refused, never missed: in text, a doctype, a processing instruction", () => {
  for (const html of ["a < b", "<3", "<!doctype html><p>x</p>", "<?xml?>", "</ p>", "x <"])
    assert.match(why(html) ?? "", /write each < in text as &lt;/, html);
});

test('every href, xlink:href included, in any case, is href="#name"', () => {
  for (const ok of ['<use href="#a"/>', '<use xlink:href="#a"/>', '<use HREF="#b-2"/>'])
    assert.deepEqual(checkSketch(`<svg>${ok}</svg>`), { ok: true }, ok);
  for (const html of [
    '<use href="http://x.test/u.svg#a"/>',
    "<use href='#a'/>",
    "<use href=#a />",
    '<use href = "#a"/>',
    '<use href="data:image/svg+xml;base64,AAAA#a"/>',
    '<use xlink:href="//x.test/#a"/>',
    '<linearGradient href="data:,x#t"/>',
    '<p hreflang="en">x</p>',
  ])
    assert.match(why(`<svg>${html}</svg>`) ?? "", /write every href as href="#name"/, html);
});

test("a sketch over 32 KB is too big; one at the limit passes", () => {
  // Bytes, not characters: é is two.
  const at = `<p>${"é".repeat((maxSketchBytes - 8) / 2)}x</p>`;
  assert.equal(new TextEncoder().encode(at).length, maxSketchBytes);
  assert.deepEqual(checkSketch(at), { ok: true });
  const over = checkSketch(`${at}x`);
  assert.equal(over.ok ? null : over.reason, "too-big");
});

test("a refusal names each element to change once, and the other rules, together", () => {
  assert.equal(
    why('<link rel=x><link><a href="http://x">1 < 2</a>'),
    `<link>, <a> aren't elements a sketch may use; it can't link, frame, run or load anything; write each < in text as &lt;; write every href as href="#name", pointing inside the sketch`,
  );
});
