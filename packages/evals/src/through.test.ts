// A case's world with Jira on through Atlassian's server (OA-276): synced
// and read through the parser, from a stand-in of the server, it is the
// fixture's own, item for item, after any number of its edits. So every
// Jira case's module, reads and evidence are the same either way, and its
// cassettes replay through the parser too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "@oriel/bindings";
import { sources } from "@oriel/sources";
import { loadFixtures, regionNamed } from "./fixtures.ts";
import { buildWorld } from "./world.ts";

const fixtures = loadFixtures({ jira: sources.jira, folder: sources.folder });
const edits = fixtures.get("jira")?.loaded.edits ?? 0;

for (let edited = 0; edited <= edits; edited++)
  test(`through Atlassian's server, after ${edited} edit(s), a world is the fixture's own`, async (t) => {
    const region = regionNamed(fixtures, "weather-epic") ?? null;
    const build = (servers: string[]) =>
      buildWorld({ fixtures, region, items: [], edited: { jira: edited }, servers });
    const [plain, through] = await Promise.all([build([]), build(["jira"])]);
    t.after(() => {
      plain.close();
      through.close();
    });
    const dts = (world: typeof plain) =>
      bindingsFor(world.region, { reader: world.reader, namespaces: world.namespaces }).dts;
    assert.equal(dts(through), dts(plain), "the agent's module, byte for byte");
    const ids = region?.items ?? [];
    assert.deepEqual(await through.reader.read(ids), await plain.reader.read(ids));
    assert.deepEqual(await through.evidence(), await plain.evidence());
    assert.deepEqual(
      await through.reader.search("checkout", 20),
      await plain.reader.search("checkout", 20),
    );
  });
