import type { Instant } from "./ids.ts";
import {
  containerShape,
  type Facets,
  type IndexRecord,
  peopleShape,
  type State,
  stateShape,
} from "./source.ts";
import {
  boolean,
  literal,
  number,
  object,
  optional,
  record,
  string,
  union,
  type Validator,
} from "./validate.ts";

export const keptDays = 90;

export const keptSince = (now: Instant): Instant =>
  new Date(Date.parse(now) - keptDays * 86_400_000).toISOString() as Instant;

// A scalar, never an item's text: a title, a description or a message's text is never a facet.
export type FacetValue = string | number | boolean | null;

export type DeclaredFacet = {
  label: string;
  of: (record: IndexRecord) => FacetValue;
  sums?: true;
};

export type DeclaredFacets = Readonly<Record<string, DeclaredFacet>>;

export type Change<T> = { before?: T; after?: T };

type Person = NonNullable<Facets["people"]>[number];
type Container = NonNullable<Facets["container"]>;

export type FacetChanges = {
  state?: Change<State>;
  people?: Change<Person[]>;
  container?: Change<Container | null>;
  declared?: Readonly<Record<string, Change<FacetValue>>>;
};

// A sync that failed partway leaves its version to the next sync, which may be another source's.
export type ChangeLogEntry = {
  seq: number;
  source: string;
  stableId: string;
  version: number;
  at: Instant;
  facets: FacetChanges;
  gone: boolean;
};

// Compared as JSON, with people in a fixed order, so a source that lists
// them differently from one sync to the next changes nothing.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (people: Person[] | undefined) =>
  people?.toSorted((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));

const change = <T>(before: T | undefined, after: T | undefined): Change<T> | undefined => {
  if (same(before, after)) return undefined;
  return {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
};

export function facetChanges(
  declared: DeclaredFacets,
  before: IndexRecord,
  after: IndexRecord,
): FacetChanges | null {
  const was = before.facets;
  const is = after.facets;
  const declaredChanges = Object.entries(declared).flatMap(([key, facet]) => {
    const changed = change(facet.of(before), facet.of(after));
    return changed ? [[key, changed] as const] : [];
  });
  const changes: FacetChanges = Object.fromEntries(
    Object.entries({
      state: change(was.state, is.state),
      people: change(sorted(was.people), sorted(is.people)),
      container: change(was.container, is.container),
      declared: declaredChanges.length ? Object.fromEntries(declaredChanges) : undefined,
    }).filter(([, value]) => value !== undefined),
  );
  return Object.keys(changes).length ? changes : null;
}

const changeOf = <T>(value: Validator<T>) =>
  object({ before: optional(value), after: optional(value) });
const facetValue: Validator<FacetValue> = union(string, number, boolean, literal(null));
const shape = object({
  state: optional(changeOf(stateShape)),
  people: optional(changeOf(peopleShape)),
  container: optional(changeOf(containerShape)),
  declared: optional(record(changeOf(facetValue))),
});

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;

export const facetChangesShape: Validator<FacetChanges> = (input, path) => {
  const result = shape(input, path);
  if (!result.ok) return result;
  const { state, people, container, declared } = result.value;
  return {
    ok: true,
    value: defined({
      state: state && defined(state),
      people: people && defined(people),
      container: container && defined(container),
      declared:
        declared &&
        Object.fromEntries(Object.entries(declared).map(([key, c]) => [key, defined(c)])),
    }),
  };
};
