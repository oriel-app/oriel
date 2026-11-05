import assert from "node:assert/strict";
import { test } from "node:test";
import { awaiting, eventTypes, exits, parseAwait, settle, typesIn } from "./drive-await.ts";

const a = "01JBZ00000000000000000000A";
const b = "01JBZ00000000000000000000B";

test("only open change sets are awaiting review", () => {
  const sets = [
    { id: a, status: "open" },
    { id: b, status: "applied" },
  ];
  assert.deepEqual(awaiting(sets), [a]);
  assert.deepEqual(awaiting([]), []);
});

test("the wait goes on while any change set it waits on is undecided or applying", () => {
  for (const status of ["open", "approved", "applying"])
    assert.equal(
      settle(
        [a, b],
        [
          { id: a, status: "rejected" },
          { id: b, status },
        ],
      ),
      null,
    );
});

test("applied and rejected end the wait with 0, one line each", () => {
  assert.deepEqual(
    settle(
      [a, b],
      [
        { id: a, status: "applied" },
        { id: b, status: "rejected" },
        { id: "01JBZ00000000000000000000C", status: "open" },
      ],
    ),
    { code: exits.decided, lines: [`applied ${a}`, `rejected ${b}`] },
  );
});

test("approved but stopped, or gone, ends the wait unfinished", () => {
  for (const status of ["stopped", "partial"])
    assert.deepEqual(settle([a], [{ id: a, status }]), {
      code: exits.unfinished,
      lines: [`${status} ${a}`],
    });
  assert.deepEqual(settle([a, b], [{ id: a, status: "applied" }]), {
    code: exits.unfinished,
    lines: [`applied ${a}`, `gone ${b}`],
  });
  assert.deepEqual(settle([a], null), { code: exits.unfinished, lines: [`gone ${a}`] });
});

test("the exit codes are distinct and leave 2 and 3 to the driver", () => {
  const codes = Object.values(exits);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(!codes.includes(2) && !codes.includes(3));
});

test("await takes a thread ID and a timeout in minutes", () => {
  assert.deepEqual(parseAwait([a]), { thread: a, minutes: 60 });
  assert.deepEqual(parseAwait([a, "--timeout", "5"]), { thread: a, minutes: 5 });
  assert.deepEqual(parseAwait([a, "--timeout", "0.5"]), { thread: a, minutes: 0.5 });
  for (const args of [
    [],
    ["../settings"],
    [a, "--timeout"],
    [a, "--timeout", "0"],
    [a, "--timeout", "soon"],
    [a, "5"],
  ])
    assert.equal(typeof parseAwait(args), "string", JSON.stringify(args));
});

test("events are read by type, across chunks, whatever else they carry", async () => {
  async function* chunks() {
    const text = 'retry: 2000\n\nid: 4\ndata: {"type":"entry","entry":{}}\n\ndata: {"type":"chan';
    yield new TextEncoder().encode(text);
    yield new TextEncoder().encode('ge-set","changeSetId":"x"}\n\ndata: not json\n\n');
  }
  const types: string[] = [];
  for await (const type of eventTypes(chunks())) types.push(type);
  assert.deepEqual(types, ["entry", "change-set", "unknown"]);
  assert.deepEqual([...typesIn("data: {}")], []);
});
