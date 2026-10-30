import assert from "node:assert/strict";
import { test } from "node:test";
import { ulid } from "./ids.ts";
import type { SourceWriter, WriteRequest } from "./source.ts";

// The assertion is the `@ts-expect-error` below, which `pnpm typecheck`
// enforces: if an unapproved request ever becomes acceptable to a writer, the
// directive goes unused and typecheck fails.
test("a writer accepts only approved requests", () => {
  const request: WriteRequest<"jira"> = {
    mutationId: ulid(0, new Uint8Array(10)),
    op: "setEstimate",
    target: "jira:SYN-12",
    expectedStableId: "10012",
    args: { points: 3 },
  };
  const apply = (writer: SourceWriter<"jira">) =>
    // @ts-expect-error a captured request is not an approved one
    writer.apply(request);
  assert.equal(typeof apply, "function");
});
