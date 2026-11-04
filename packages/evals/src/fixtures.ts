// Every declared connector's fixture (decision 0049), loaded once a round: the
// data a case's world is built from. A case names an item as its fixture
// does, `<kind>:<name>`: most fixtures name an item by its key, so the name
// is its ID (`jira:SYN-12`), and the folder's by its path
// (`folder:meeting-notes.md`). A new connector's fixture needs nothing here.
import {
  type FixtureRegion,
  type ItemId,
  type LoadedFixture,
  parseItemId,
  type SourceDeclaration,
} from "@oriel/core";
import { sources } from "@oriel/sources";

export type Fixture = { declaration: SourceDeclaration; loaded: LoadedFixture };

// By kind, in declared order.
export type Fixtures = ReadonlyMap<string, Fixture>;

// Each declaration's fixture, loaded. Tests may pass others, or fewer.
export function loadFixtures(
  declarations: Readonly<Record<string, SourceDeclaration>> = sources,
): Fixtures {
  return new Map(
    Object.entries(declarations).map(([kind, declaration]) => [
      kind,
      { declaration, loaded: declaration.fixture.load() },
    ]),
  );
}

// The item a case names, or why a case can't hold it.
export function itemNamed(fixtures: Fixtures, name: string): { id: ItemId } | { problem: string } {
  const at = name.indexOf(":");
  const kind = name.slice(0, at);
  const fixture = fixtures.get(kind);
  if (at < 1 || !fixture) return { problem: `no ${kind || "such"} fixture is loaded` };
  return fixture.loaded.item(name.slice(at + 1));
}

// A region of any fixture's, by its name.
export function regionNamed(fixtures: Fixtures, name: string): FixtureRegion | undefined {
  for (const { loaded } of fixtures.values()) {
    const region = loaded.regions.find((r) => r.name === name);
    if (region) return region;
  }
  return undefined;
}

// The fixture an item is from.
export const fixtureOf = (fixtures: Fixtures, id: string): LoadedFixture | undefined =>
  fixtures.get(parseItemId(id)?.kind ?? "")?.loaded;
