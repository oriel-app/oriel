import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemId } from "./ids.ts";
import { cantComeBack, comesBack, memberOf, removalForecast } from "./workstream.ts";

const member = (id: string, stableId: string) => ({ id: id as ItemId, stableId });

test("a removal gives back what the index has, under its handle now, and nothing it lost", () => {
  const moved = member("jira:SYN-3", "103");
  const deleted = member("jira:SYN-4", "104");
  const records = [member("jira:OPS-9", "103"), member("jira:SYN-5", "105")];
  assert.deepEqual(comesBack([moved, deleted], records), {
    back: ["jira:OPS-9"],
    lost: [deleted],
  });
  // The handle a removal names it by is the one it comes back under.
  assert.equal(memberOf("jira:OPS-9", [moved, deleted], records), moved);
  assert.equal(memberOf("jira:SYN-4", [moved, deleted], records), deleted);
  // Its Undo gives back what it can, and says what it can't.
  assert.equal(
    removalForecast([moved, deleted], records),
    "If this applies, its Undo adds back only OPS-9: SYN-4 is no longer in the window, so it can't come back.",
  );
  assert.equal(
    removalForecast([deleted], records),
    "If this applies, there's no Undo: SYN-4 is no longer in the window, so it can't come back.",
  );
  assert.equal(removalForecast([moved], records), null);
});

test("what can't come back is said by key, or as it or they", () => {
  assert.equal(
    cantComeBack(["jira:SYN-1", "jira:SYN-2", "jira:SYN-3"]),
    "SYN-1, SYN-2 and SYN-3 are no longer in the window, so they can't come back",
  );
  assert.equal(
    cantComeBack(["jira:SYN-1"], false),
    "It's no longer in the window, so it can't come back",
  );
  assert.equal(
    cantComeBack(["jira:SYN-1", "jira:SYN-2"], false),
    "They're no longer in the window, so they can't come back",
  );
});
