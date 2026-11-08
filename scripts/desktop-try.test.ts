import assert from "node:assert/strict";
import { test } from "node:test";
import { findPid } from "./desktop-try.ts";

test("the copy's PID is the one running its own executable, not a helper", () => {
  const exe = "/tmp/oriel-try-1/Oriel.app/Contents/MacOS/Oriel";
  const table = [
    "  101 /Applications/Oriel.app/Contents/MacOS/Oriel --data x",
    `  202 ${exe}/../../Frameworks/Oriel Helper.app/Contents/MacOS/Oriel Helper --type=gpu`,
    `  303 ${exe} --background --data /tmp/oriel-try-1/data --launch-file`,
  ].join("\n");
  assert.equal(findPid(table, exe), 303);
  assert.equal(findPid(table, "/tmp/oriel-try-2/Oriel.app/Contents/MacOS/Oriel"), null);
});
