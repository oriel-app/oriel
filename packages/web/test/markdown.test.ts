import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, opens, parse } from "../src/markdown.ts";

const text = (text: string) => ({ kind: "text", text });

test("links go only to the web", () => {
  for (const unsafe of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](/local)"])
    assert.deepEqual(inline(unsafe), [text(unsafe)], unsafe);
});

test("nesting past a few levels reads as text, so a hostile reply can't break the page", () => {
  const deep = parse(`${">".repeat(5000)} deep`);
  assert.ok(JSON.stringify(deep).includes("deep"));
  const nested = parse(`${"[".repeat(5000)}a${"](https://x)".repeat(5000)}`);
  assert.ok(JSON.stringify(nested).includes("https://x"));
});

test("a link opens only to a site the thread's items come from", () => {
  const sites = new Set(["https://oriel.atlassian.net"]);
  assert.equal(opens("https://oriel.atlassian.net/browse/OA-13", sites), true);
  assert.equal(opens("https://attacker.example/?d=OA-13", sites), false);
  assert.equal(opens("https://oriel.atlassian.net.attacker.example/", sites), false);
  assert.equal(opens("https://oriel.atlassian.net/", new Set()), false);
});

// Each would take minutes or hours if a pattern backtracked; the timeout makes
// that a failure rather than a hang.
test(
  "lines built to make the patterns backtrack are read in linear steps",
  { timeout: 5_000 },
  () => {
    const spaces = " ".repeat(5_000);
    assert.deepEqual(parse(`#${spaces}\u2028`), [{ kind: "heading", level: 1, children: [] }]);
    assert.equal(parse(`-${spaces} x`)[0]?.kind, "list");
    assert.equal(parse(`a | b\n${spaces}|${spaces}x`)[0]?.kind, "paragraph");
    assert.equal(parse(`${"[a](<x".repeat(20_000)})`)[0]?.kind, "paragraph");
    assert.equal(parse("[a](".repeat(20_000))[0]?.kind, "paragraph");
  },
);
