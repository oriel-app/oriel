import assert from "node:assert/strict";
import { test } from "node:test";
import { readFuses, setFuses } from "./fuses.ts";

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

test("fuses read as Electron ships them", () => {
  assert.deepEqual(readFuses(binary()), {
    runAsNode: true,
    cookieEncryption: false,
    nodeOptions: true,
    inspectArguments: true,
    asarIntegrity: false,
    onlyLoadAppFromAsar: false,
    browserV8Snapshot: false,
    fileProtocolPrivileges: true,
    wasmTrapHandlers: true,
  });
});

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
  assert.throws(() => setFuses(Buffer.from("no wire here"), { runAsNode: false }), /no fuse wire/);
  assert.throws(
    () => setFuses(Buffer.concat([binary(), binary()]), { runAsNode: false }),
    /more than one fuse wire/,
  );
  assert.throws(() => setFuses(binary("101100011", 2), { runAsNode: false }), /version 2, not 1/);
  assert.throws(
    () => setFuses(binary("r01100011"), { runAsNode: false }),
    /runAsNode fuse isn't in this binary/,
  );
  assert.throws(
    () => setFuses(binary("1011"), { fileProtocolPrivileges: false }),
    /isn't in this binary/,
  );
});
