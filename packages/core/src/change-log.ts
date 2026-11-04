// The change log (decision 0027): what each sync changed in an item's
// facets, before and after, and when it tombstoned one. Every source fills
// the common facets (state, people, container); each declares its others,
// with their labels, on its `SourceDeclaration`, and core never names one.
// Facets only, never content: a title, a description or a message's text is
// never a facet.
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

// How long the index keeps a change log entry, and an unresolved reference.
export const keptDays = 90;

// The instant `keptDays` before `now`: anything older goes.
export const keptSince = (now: Instant): Instant =>
  new Date(Date.parse(now) - keptDays * 86_400_000).toISOString() as Instant;

// What a declared facet's value is: a scalar, such as a count, a review
// state or a priority, never an item's text.
export type FacetValue = string | number | boolean | null;

// A facet a source declares beyond the common ones.
export type DeclaredFacet = {
  // What the change log and the overview call it, such as "Review state".
  label: string;
  // Its value on one of the source's index records.
  of: (record: IndexRecord) => FacetValue;
};

// A source's declared facets, by a key of its own choosing.
export type DeclaredFacets = Readonly<Record<string, DeclaredFacet>>;

// A facet before and after a sync. Either is absent where the item had no
// such facet then.
export type Change<T> = { before?: T; after?: T };

type Person = NonNullable<Facets["people"]>[number];
type Container = NonNullable<Facets["container"]>;

// What one sync changed in one item: only the facets that changed.
export type FacetChanges = {
  state?: Change<State>;
  people?: Change<Person[]>;
  container?: Change<Container | null>;
  // The source's declared facets, by their keys.
  declared?: Readonly<Record<string, Change<FacetValue>>>;
};

// One entry: an item's facets changed, or it was tombstoned (`gone`, with
// no facets), by a sync that started at `at` and was to take snapshot
// `version` (one that failed partway leaves its version to the next sync,
// which may be another source's). `seq` orders entries as they committed.
export type ChangeLogEntry = {
  seq: number;
  // The item's connection: its ID's prefix.
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

// What changed between an item as the index held it and as a sync brings
// it, or null when no facet did. An item the index didn't hold has nothing
// to compare, and so changes nothing here.
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

// Without the keys a validator set to undefined, as JSON leaves them out.
const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;

// An entry's facets as the index stores them, checked on the way out.
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
