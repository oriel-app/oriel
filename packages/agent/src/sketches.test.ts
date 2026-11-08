// Sketches (decision 0033): sketch() hands Oriel HTML and a height; Oriel
// checks it and shows it under the reply with the blocks, in the order
// asked, or refuses it with what to change, and the run goes on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { noThreads, type Ulid } from "@oriel/core";
import type { AgentEvent } from "./contract.ts";
import { fixtureRegion, harness, regionBindings } from "./testing.ts";

const weather = fixtureRegion("weather-epic");

const options = {
  bindings: (
    region: Parameters<typeof regionBindings>[0],
    thread: Ulid,
    shown?: Parameters<typeof regionBindings>[2],
  ) => regionBindings(region, thread, shown, noThreads),
};

const sketches = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.kind === "sketch" ? [event.sketch] : []));
const refusals = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.kind === "sketch.refused" ? [event.reason] : []));

const call = (html: string, height: unknown = 240) =>
  `await sketch(${JSON.stringify(html)}, ${JSON.stringify(height)});`;

test("a sketch that isn't allowed is refused with the names to change, shows nothing, and the run goes on", async () => {
  const { turn } = harness(
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
});

test("an answer shows at most two sketches, each once; one too big is refused", async () => {
  const { turn } = harness(
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
});

test("a sketch's HTML never reaches a log line or the run's record: only its size", async () => {
  const html = "<p>SYN-26 Let operations mark a sailing</p>";
  const { turn, logged, records } = harness(
    [{ scripts: [call(html, 400), call(html, 640)] }, { text: ["Drawn."] }],
    options,
  );
  const events = await turn({ region: weather });
  assert.equal(sketches(events).length, 2);
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
