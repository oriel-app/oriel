import assert from "node:assert/strict";
import { test } from "node:test";
import { setFuses } from "./fuses.ts";

const sentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
// As Electron 45 ships: version 1, nine fuses.
const binary = (wire = "101100011", version = 1) =>
  Buffer.concat([
    Buffer.from("…code before…"),
    Buffer.from(sentinel),
    Buffer.from([version, wire.length]),
    Buffer.from(wire),
    Buffer.from("…code after…"),
  ]);

test("setting fuses changes those bytes and nothing else", () => {
  const before = binary();
  const after = Buffer.from(before);
  setFuses(after, {
    runAsNode: false,
    nodeOptions: false,
    inspectArguments: false,
    fileProtocolPrivileges: false,
  });
  assert.equal(after.length, before.length);
  assert.ok(after.includes(Buffer.from(`${sentinel}\x01\x09000000001…code after…`)));
  assert.deepEqual(after.subarray(0, 20), before.subarray(0, 20));
});

test("a binary with no wire, two wires, another version or a removed fuse stops the build", () => {
  assert.throws(() => setFuses(Buffer.from("no wire here"), { runAsNode: false }));
  assert.throws(() => setFuses(Buffer.concat([binary(), binary()]), { runAsNode: false }));
  assert.throws(() => setFuses(binary("101100011", 2), { runAsNode: false }));
  assert.throws(() => setFuses(binary("r01100011"), { runAsNode: false }));
  assert.throws(() => setFuses(binary("1011"), { fileProtocolPrivileges: false }));
});
