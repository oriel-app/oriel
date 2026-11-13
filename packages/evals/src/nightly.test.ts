import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Fetch } from "./anthropic.ts";
import { type Night, type NightIo, recordNight } from "./nightly.ts";
import { streamed, tempDir } from "./testing.ts";

const tapes = (root: URL) =>
  new Map(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path.slice(fileURLToPath(root).length), readFileSync(path, "utf8")] as const;
      }),
  );
const of = (all: Map<string, string>, id: string) =>
  [...all].filter(([path]) => path.startsWith(`${id}/`));

test("the night records only cases whose requests changed or stale.md names, and still writes nightly.json", async (t) => {
  const dir = pathToFileURL(`${realpathSync(fileURLToPath(tempDir(t)))}/`);
  const env = fileURLToPath(new URL(".env", dir));
  writeFileSync(env, "ANTHROPIC_API_KEY=sk-ant-fake-0123456789abcdef\n");
  const cases = new URL("cases/", dir);
  mkdirSync(cases);
  const writeCase = (id: string, prompt: string) =>
    writeFileSync(
      new URL(`${id}.json`, cases),
      JSON.stringify({
        id,
        split: "train",
        kind: 2,
        region: "checkout-epic",
        prompt,
        expect: [{ grader: "mentions", text: ["Revert"] }],
      }),
    );
  writeCase("undo-a", "How do I undo a change here?");
  writeCase("undo-b", "Can I take back an applied change?");
  let draws = 0;
  const network: Fetch = async () =>
    streamed({ text: `Revert it from the thread (draw ${++draws}).` });
  let tick = 0;
  const night = (date: string): NightIo => ({
    cases,
    cassettes: new URL("cassettes/", dir),
    rounds: new URL("rounds/", dir),
    envFile: new URL("missing/.env", dir),
    stale: new URL("stale.md", dir),
    nightly: new URL("nightly.json", dir),
    env,
    date,
    commit: "0123456789abcdef",
    network,
    now: () => Date.UTC(2026, 10, 1, 2, tick++),
    clock: () => tick++,
    log: () => {},
    error: () => {},
  });
  const nightly = () => JSON.parse(readFileSync(new URL("nightly.json", dir), "utf8")) as Night;

  assert.equal((await recordNight(night("2026-11-10"))).code, 0);
  const recorded = tapes(new URL("cassettes/", dir));
  assert.ok(of(recorded, "undo-a").length && of(recorded, "undo-b").length);

  const before = draws;
  assert.equal((await recordNight(night("2026-11-11"))).code, 0);
  assert.ok(draws > before);
  assert.deepEqual(tapes(new URL("cassettes/", dir)), recorded);
  assert.equal(nightly().date, "2026-11-11");
  assert.deepEqual(
    Object.values(nightly().cases).map((c) => c.kept),
    [true, true],
  );

  writeCase("undo-b", "Can I take back a change once it's applied?");
  assert.equal((await recordNight(night("2026-11-12"))).code, 0);
  const changed = tapes(new URL("cassettes/", dir));
  assert.deepEqual(of(changed, "undo-a"), of(recorded, "undo-a"));
  assert.notDeepEqual(of(changed, "undo-b"), of(recorded, "undo-b"));
  assert.equal(nightly().cases["undo-b"]?.kept, false);

  writeFileSync(new URL("stale.md", dir), "`undo-a`: the module says Revert differently\n");
  assert.equal((await recordNight(night("2026-11-13"))).code, 0);
  const named = tapes(new URL("cassettes/", dir));
  assert.notDeepEqual(of(named, "undo-a"), of(changed, "undo-a"));
  assert.deepEqual(of(named, "undo-b"), of(changed, "undo-b"));
  assert.ok(!existsSync(new URL("stale.md", dir)));
});
