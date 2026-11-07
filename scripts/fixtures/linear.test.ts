import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  identifierOf,
  linearWorldPath,
  loadLinearWorld,
  parseLinearWorld,
} from "../../packages/linear/src/world.ts";
import { linearWorld } from "./linear.ts";

test("fixtures/linear/world.json is what the generator writes", () => {
  assert.equal(
    readFileSync(linearWorldPath, "utf8"),
    `${JSON.stringify(linearWorld(), null, 2)}\n`,
  );
  assert.doesNotThrow(() => loadLinearWorld());
});

test("every free-text field has an injection: an issue's title and description, a project's description and a person's name", () => {
  const world = loadLinearWorld();
  const injection = /ignore (all )?(previous|your) instructions/i;
  assert.ok(world.issues.some((each) => injection.test(each.title)));
  assert.ok(world.issues.some((each) => injection.test(each.description)));
  assert.ok(world.projects.some((each) => injection.test(each.description)));
  assert.ok(world.people.some((each) => injection.test(each.name)));
});

test("it has the mess a real team has", () => {
  const world = loadLinearWorld();
  const titles = world.issues.map((each) => each.title);
  assert.ok(
    titles.some((title, i) => titles.indexOf(title) !== i),
    "two issues share a title",
  );
  assert.ok(
    world.issues.some(
      (each) => world.people.find((one) => one.id === each.assignee)?.active === false,
    ),
  );
  assert.ok(
    world.projects.some((project) => !world.issues.some((each) => each.project === project.id)),
  );
  assert.ok(world.issues.some((each) => each.parent !== null));
  assert.ok(world.issues.some((each) => each.description.length > 10_000));
  assert.ok(world.issues.some((each) => /[^\u0000-\u007f]/.test(each.title)));
  assert.ok(world.issues.some((each) => identifierOf(world, each).startsWith("OPS-")));
});

test("an issue whose project isn't in the world, or an identifier used twice, is refused", () => {
  const base = linearWorld();
  const [first, second] = base.issues;
  assert.ok(first && second);
  const broken = [
    { ...base, issues: [{ ...first, project: "00000006-0000-4000-8000-0000000000ff" }] },
    { ...base, issues: [first, { ...second, number: first.number }] },
  ];
  for (const world of broken) assert.equal(parseLinearWorld(world).ok, false);
});
