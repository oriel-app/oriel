// Sketches (decision 0033): sketch() hands Oriel HTML and a height; Oriel
// checks it and shows it under the reply with the blocks, in the order
// asked, or refuses it with what to change, and the run goes on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { noThreads, sketchTokens, type Ulid } from "@oriel/core";
import type { AgentEvent } from "./contract.ts";
import { fixtureRegion, harness, kinds, regionBindings } from "./testing.ts";

const weather = fixtureRegion("weather-epic");

const options = {
  bindings: (
    region: Parameters<typeof regionBindings>[0],
    thread: Ulid,
    shown?: Parameters<typeof regionBindings>[2],
  ) => regionBindings(region, thread, shown, { oriel: noThreads }),
};

const contentOf = (model: ReturnType<typeof harness>["model"], step = 1) =>
  model.conversations[0]?.results[step]?.[0]?.content ?? "";

const sketches = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.kind === "sketch" ? [event.sketch] : []));
const refusals = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.kind === "sketch.refused" ? [event.reason] : []));

const call = (html: string, height: unknown = 240) =>
  `await sketch(${JSON.stringify(html)}, ${JSON.stringify(height)});`;

test("a sketch is shown under the reply as Oriel checked it, and the agent reads the theme's variables", async () => {
  const html = '<svg><rect width="9" height="9" fill="var(--line)"/></svg><p>Ready</p>';
  const { turn, model } = harness([{ scripts: [call(html, 400)] }, { text: ["Drawn."] }], options);
  const events = await turn({ region: weather, text: "Draw the release." });
  assert.deepEqual(kinds(events), ["run.started", "run.finished", "text", "sketch", "done"]);
  const [sketch] = sketches(events);
  assert.equal(sketch?.html, html);
  assert.equal(sketch?.height, 400);
  assert.match(sketch?.id ?? "", /^[0-9A-HJKMNP-TV-Z]{26}$/);
  const content = contentOf(model);
  assert.match(content, /Oriel shows your sketch under your reply, 400 px high/);
  for (const token of sketchTokens) assert.ok(content.includes(token), token);
  assert.doesNotMatch(content, /--accent|--danger|--done/);
});

test("blocks and sketches show in the order the runs asked for them", async () => {
  const { turn } = harness(
    [
      { scripts: [call("<p>first</p>")] },
      {
        scripts: [
          `await search("weather", 5);
await show({ read: "search", args: ["weather", 5], form: "table", columns: ["title"] });`,
        ],
      },
      { scripts: [call("<p>third</p>", 640)] },
      { text: ["Here."] },
    ],
    options,
  );
  const events = await turn({ region: weather });
  const shown = events.filter((e) => e.kind === "sketch" || e.kind === "block");
  assert.deepEqual(
    shown.map((e) => (e.kind === "sketch" ? e.sketch.html : e.kind)),
    ["<p>first</p>", "block", "<p>third</p>"],
  );
});

test("a sketch that isn't allowed is refused with the names to change, shows nothing, and the run goes on", async () => {
  const { turn, model } = harness(
    [
      {
        scripts: [
          [
            call('<IFRAME SRC="http://x.test/"></IFRAME><a href="#top">top</a>'),
            call('<svg><use href="http://x.test/u.svg#a"/></svg>'),
            call("a < b"),
            // Past the types, as a script that casts can be.
            `await sketch("<p>fine</p>", 300 as number as 240);`,
            "return 'went on';",
          ].join("\n"),
        ],
      },
      { text: ["Let me fix that."] },
    ],
    options,
  );
  const events = await turn({ region: weather });
  assert.deepEqual(sketches(events), []);
  assert.deepEqual(refusals(events), ["not-allowed", "not-allowed", "not-allowed", "malformed"]);
  const content = contentOf(model);
  assert.match(content, /refused the sketch, and shows nothing: <IFRAME>, <a> aren't elements/);
  assert.match(content, /write every href as href="#name"/);
  assert.match(content, /write each < in text as &lt;/);
  assert.match(content, /h as 240, 400 or 640/);
  assert.match(content, /Returned: "went on"/);
});

test("an answer shows at most two sketches, each once; one too big is refused", async () => {
  const { turn, model } = harness(
    [
      {
        scripts: [
          [
            call("<p>one</p>"),
            call("<p>one</p>"),
            call("<p>two</p>"),
            call("<p>three</p>"),
            `await sketch("<p>" + "x".repeat(32 * 1024) + "</p>", 240);`,
          ].join("\n"),
        ],
      },
      { text: ["Two of them."] },
    ],
    options,
  );
  const events = await turn({ region: weather });
  assert.deepEqual(
    sketches(events).map((sketch) => sketch.html),
    ["<p>one</p>", "<p>two</p>"],
  );
  assert.deepEqual(refusals(events), ["too-many", "too-big"]);
  const content = contentOf(model);
  assert.match(content, /Oriel already shows that sketch/);
  assert.match(content, /a reply shows at most 2 sketches/);
  assert.match(content, /it is 32775 bytes; the most is 32768/);
});

test("a run that fails shows no sketch", async () => {
  const { turn, model } = harness(
    [{ scripts: [`${call("<p>drawn</p>")}\nthrow new Error("oops");`] }, { text: ["It failed."] }],
    options,
  );
  const events = await turn({ region: weather });
  assert.deepEqual(sketches(events), []);
  assert.match(contentOf(model), /Oriel shows nothing from a run that stopped\./);
});

test("a sketch's HTML never reaches a log line or the run's record: only its size", async () => {
  const html = "<p>SYN-26 Let operations mark a sailing</p>";
  const { turn, logged, records } = harness(
    [{ scripts: [call(html, 400), call(html, 640)] }, { text: ["Drawn."] }],
    options,
  );
  const events = await turn({ region: weather });
  // The same HTML at another height is another sketch.
  assert.deepEqual(
    sketches(events).map((sketch) => sketch.height),
    [400, 640],
  );
  const lines = logged.filter((line) => line.message === "sandbox.read");
  const bytes = { bytes: html.length };
  assert.deepEqual(
    lines.map((line) => line.fields["args"]),
    [
      [bytes, 400],
      [bytes, 640],
    ],
  );
  const reads = records.runs.flatMap((run) => run.reads.map((read) => read.args));
  assert.deepEqual(reads, [
    [bytes, 400],
    [bytes, 640],
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /Let operations/);
});
