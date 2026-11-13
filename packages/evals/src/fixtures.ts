import {
  type FixtureRegion,
  type ItemId,
  type LoadedFixture,
  parseItemId,
  type SourceDeclaration,
} from "@oriel/core";
import { sources } from "@oriel/sources";

export type Fixture = { declaration: SourceDeclaration; loaded: LoadedFixture };

export type Fixtures = ReadonlyMap<string, Fixture>;

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

export function itemNamed(fixtures: Fixtures, name: string): { id: ItemId } | { problem: string } {
  const at = name.indexOf(":");
  const kind = name.slice(0, at);
  const fixture = fixtures.get(kind);
  if (at < 1 || !fixture) return { problem: `no ${kind || "such"} fixture is loaded` };
  return fixture.loaded.item(name.slice(at + 1));
}

export function regionNamed(fixtures: Fixtures, name: string): FixtureRegion | undefined {
  for (const { loaded } of fixtures.values()) {
    const region = loaded.regions.find((r) => r.name === name);
    if (region) return region;
  }
  return undefined;
}

export const fixtureOf = (fixtures: Fixtures, id: string): LoadedFixture | undefined =>
  fixtures.get(parseItemId(id)?.kind ?? "")?.loaded;
