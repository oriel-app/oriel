import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import annotations, { annotation } from "./annotations.ts";

test("an annotation is one line, its message and properties escaped", () => {
  assert.equal(
    annotation("test failed: a, b: c", "50% off\nthen more", "scripts/x.test.ts", 12),
    "::error file=scripts/x.test.ts,line=12,title=test failed%3A a%2C b%3A c::50%25 off%0Athen more\n",
  );
  assert.equal(annotation("shots", "stopped"), "::error title=shots::stopped\n");
});

test("the reporter writes one annotation for each failing test, not its suite", async () => {
  const file = fileURLToPath(new URL("./x.test.ts", import.meta.url));
  const assertion = new Error("test failed", {
    cause: new Error("Expected values to be strictly equal:\n\n1 !== 2\n"),
  });
  async function* events() {
    yield { type: "test:pass", data: { name: "fine", file, details: {} } };
    yield {
      type: "test:fail",
      data: { name: "adds", file, line: 7, details: { error: assertion } },
    };
    yield {
      type: "test:fail",
      data: { name: "sums", file, details: { type: "suite", error: assertion } },
    };
  }
  const lines: string[] = [];
  for await (const line of annotations(events())) lines.push(line);
  assert.deepEqual(lines, [
    "::error file=scripts/x.test.ts,line=7,title=test failed%3A adds::Expected values to be strictly equal:\n",
  ]);
});
