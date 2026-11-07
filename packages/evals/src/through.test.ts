// A case's world with Jira on through Atlassian's server (OA-276): synced
// and read through the parser, from a stand-in of the server, it is the
// fixture's own, item for item, after any number of its edits. So every
// Jira case's module, reads and evidence are the same either way, and its
// cassettes replay through the parser too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor } from "@oriel/bindings";
import { itemId } from "@oriel/core";
import { loadSlackFixture } from "@oriel/slack";
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

test("through Slack's server, a world is the fixture's own", async (t) => {
  const all = loadFixtures({ jira: sources.jira, slack: sources.slack, folder: sources.folder });
  const region = regionNamed(all, "weather-epic") ?? null;
  // Every message in the fixture's picked channel, its replies with it.
  const fixture = loadSlackFixture();
  const ids = fixture.channels
    .filter((channel) => fixture.picked.includes(channel.id))
    .flatMap((channel) => channel.messages.map((m) => itemId("slack", `${channel.id}-${m.ts}`)));
  const build = (servers: string[]) =>
    buildWorld({ fixtures: all, region, items: ids, edited: {}, servers });
  const [plain, through] = await Promise.all([build([]), build(["slack"])]);
  t.after(() => {
    plain.close();
    through.close();
  });
  const dts = (world: typeof plain) =>
    bindingsFor(world.region, { reader: world.reader, namespaces: world.namespaces }).dts;
  assert.equal(dts(through), dts(plain), "the agent's module, byte for byte");
  const read = await plain.reader.read(ids);
  assert.ok(read.filter((each) => each.status === "ok").length > 5);
  assert.deepEqual(await through.reader.read(ids), read);
  assert.deepEqual(await through.evidence(), await plain.evidence());
  assert.deepEqual(await through.reader.search("fare", 50), await plain.reader.search("fare", 50));
});
