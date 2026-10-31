import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { connectSlack } from "./connect.ts";
import { fixtureApi } from "./fixture.ts";

const fixture = loadSlackFixture();

test("picked channels are found by name, with or without #, or by ID, once each", async () => {
  const { api, calls } = fixtureApi(fixture, { pageSize: 1 });
  const workspace = await connectSlack(api, ["#weather-disruptions", weather, " random "]);
  assert.deepEqual(workspace, {
    teamId: "T0FERROWK1",
    url: "https://ferrowick-example.slack.com/",
    channels: [
      { id: weather, name: "weather-disruptions" },
      { id: "C0FW2RANDOM", name: "random" },
    ],
    missing: [],
  });
  // One channel a page: it followed the cursor.
  assert.equal(calls.filter((c) => c.method === "conversations.list").length, 2);
});

test("a channel it can't find is reported, never guessed at", async () => {
  const { api } = fixtureApi(fixture);
  const workspace = await connectSlack(api, ["weather", "weather-disruptions"]);
  assert.deepEqual(workspace.channels, [{ id: weather, name: "weather-disruptions" }]);
  assert.deepEqual(workspace.missing, ["weather"]);
});
