// Every source, by kind, as it declares itself: the one list the composition
// root (packages/server) and the eval harness read. Adding a source adds it
// here, once. Core keeps no list of kinds: this is the closed list, and each
// kind's key shape is its declaration's (decision 0049).
import {
  type Candidate,
  type ConnectorView,
  type IndexRecord,
  itemOrder,
  kindOf,
  type NamespaceSpec,
  type Opened,
  type OverviewInput,
  type ParsedItemId,
  parseItemId,
  type OpSpecs,
  type Recognizer,
  recognizeAll,
  type SourceDeclaration,
  type SourceServer,
} from "@oriel/core";
import { folderDeclaration } from "@oriel/folder";
import { jiraDeclaration } from "@oriel/jira";
import { linearDeclaration } from "@oriel/linear";
import { sheetsDeclaration } from "@oriel/sheets";
import { slackDeclaration } from "@oriel/slack";
import { trackerDeclaration } from "@oriel/tracker";

// Each under its own kind, which a test checks. An untagged create, from
// before migration 0031, goes to the first kind whose catalogue has its op,
// so Linear comes after Jira, and the stand-in tracker last.
const declared = {
  jira: jiraDeclaration,
  linear: linearDeclaration,
  folder: folderDeclaration,
  slack: slackDeclaration,
  sheets: sheetsDeclaration,
  tracker: trackerDeclaration,
};

// A kind some source declares.
export type DeclaredKind = keyof typeof declared;

// Each source's declaration. It is also how each shows in the window
// (`Presentations`).
export const sources: Readonly<Record<DeclaredKind, SourceDeclaration>> = declared;

// Every declared kind, in the order the window and a region's module list
// them.
export const sourceKinds = Object.keys(declared) as readonly DeclaredKind[];

const isDeclared = (kind: string): kind is DeclaredKind => Object.hasOwn(declared, kind);

// A kind's declaration, or undefined when no source declares it.
export const declarationOf = (kind: string): SourceDeclaration | undefined =>
  isDeclared(kind) ? sources[kind] : undefined;

// An item ID of a declared kind whose key has that kind's shape, or null.
export function parseDeclared(id: string): (ParsedItemId & { kind: DeclaredKind }) | null {
  const parsed = parseItemId(id);
  if (!parsed || !isDeclared(parsed.kind) || !sources[parsed.kind].key.test(parsed.key))
    return null;
  return { ...parsed, kind: parsed.kind };
}

// Item IDs in one order everywhere: by kind, in declared order, then by
// connection and key.
export const byItemId = itemOrder(sourceKinds);

// One field of every source that declares it, in `sourceKinds` order.
function each<T>(
  field: (declaration: SourceDeclaration, kind: DeclaredKind) => T | undefined,
): Partial<Record<DeclaredKind, T>> {
  return Object.fromEntries(
    sourceKinds.flatMap((kind) => {
      const value = field(sources[kind], kind);
      return value === undefined ? [] : [[kind, value]];
    }),
  );
}

// How every connector shows in the window, in declared order, which the
// server sends the page (decision 0049).
// Its offer and steps are words and step kinds; their server halves stay
// here.
export const connectorViews: readonly ConnectorView[] = sourceKinds.map((kind) => {
  const { name, inSentence, icon, keysReadAs, columns, specs, offer, connect, review, standIn } =
    sources[kind];
  return {
    kind,
    name,
    inSentence,
    icon,
    keysReadAs,
    columns,
    writable: specs !== undefined,
    offer: offer ?? null,
    connect: connect ? { steps: connect.steps } : null,
    review: review?.step ?? null,
    options: sources[kind].optionFields ?? [],
    standIn: standIn ?? null,
  };
});

// Every source server a connector knows, with its kind, in declared order:
// what recognising the person's servers looks them up in (decision 0059).
export const knownServers: readonly { kind: DeclaredKind; server: SourceServer }[] =
  sourceKinds.flatMap((kind) => (sources[kind].servers ?? []).map((server) => ({ kind, server })));

// What each source's items are, as bindings' `items` takes them.
export const itemDocs = each((declaration) => declaration.itemDoc);

// How change sets treat each writable source's ops.
export const specs: Partial<Record<DeclaredKind, OpSpecs>> = each(
  (declaration) => declaration.specs,
);

type ContextOf<D> = D extends { namespace: (records: never, context: infer C) => NamespaceSpec }
  ? C
  : never;

type Declared = typeof declared;
type Needs<K extends keyof Declared> = ContextOf<Declared[K]>;

// What only the composition root knows that each source with a namespace
// needs, by kind. A source that declares a namespace is required here, unless
// its namespace takes no context at times, as Slack's while it isn't
// connected.
export type NamespaceContexts = {
  [
    K in keyof Declared as [Needs<K>] extends [never]
      ? never
      : undefined extends Needs<K>
        ? never
        : K
  ]: Needs<K>;
} & {
  [
    K in keyof Declared as [Needs<K>] extends [never]
      ? never
      : undefined extends Needs<K>
        ? K
        : never
  ]?: Needs<K>;
};

// Each source's namespace, for bindings, from the index.
export function namespacesFor(
  records: readonly IndexRecord[],
  contexts: NamespaceContexts,
): Partial<Record<DeclaredKind, NamespaceSpec>> {
  const given: Partial<Record<DeclaredKind, unknown>> = contexts;
  // `NamespaceContexts` gives each source the context its own namespace takes.
  return each((declaration, kind) => declaration.namespace?.(records, given[kind] as never));
}

type ScopeOf<D> = D extends { recognizer: (context: infer R) => Recognizer } ? R : never;

// What only the composition root knows that each source's recognizer needs,
// by kind: a source left out, such as one not connected, recognizes nothing.
export type RecognizerScopes = {
  [K in keyof Declared as [ScopeOf<Declared[K]>] extends [never] ? never : K]?: ScopeOf<
    Declared[K]
  >;
};

// Every source's recognizer as one, for Oriel's sync and anything else
// holding text, such as the item panel (decision 0027).
export function recognizerFor(scopes: RecognizerScopes): Recognizer {
  const given: Partial<Record<DeclaredKind, unknown>> = scopes;
  return recognizeAll(
    sourceKinds.flatMap((kind) =>
      // `RecognizerScopes` gives each source the scope its recognizer takes.
      kind in given ? [sources[kind].recognizer(given[kind] as never)] : [],
    ),
  );
}

// An open connection as the composition root holds it: its connector's kind
// and what that connector's `open` gave it.
export type OpenSource = { kind: string; opened: Opened };

// The first open connection of each declared kind, by kind: what a kind's
// recognizer and namespace take, until a kind can have several open.
const firstOpen = (open: readonly OpenSource[]): Partial<Record<DeclaredKind, Opened>> =>
  Object.fromEntries(
    sourceKinds.flatMap((kind) => {
      const found = open.find((each) => each.kind === kind);
      return found ? [[kind, found.opened]] : [];
    }),
  );

// Every open connection's recognizer as one, each in its connection's scope.
// A kind with none open recognizes nothing.
export function recognizerOf(open: readonly OpenSource[]): Recognizer {
  const scopes = Object.fromEntries(
    Object.entries(firstOpen(open)).map(([kind, opened]) => [kind, opened.scope]),
  );
  // Each scope is what its own connector's `open` gave, so it is the scope
  // its recognizer takes.
  return recognizerFor(scopes as RecognizerScopes);
}

// Each source's namespace, for bindings, from the index and each kind's
// open connection's context, asked for now. A kind with none open gets its
// namespace's context-free form, as Slack's while it isn't connected.
export function namespacesOf(
  records: readonly IndexRecord[],
  open: readonly OpenSource[],
): Partial<Record<DeclaredKind, NamespaceSpec>> {
  const contexts = Object.fromEntries(
    Object.entries(firstOpen(open)).map(([kind, opened]) => [kind, opened.context()]),
  );
  // As above: each context is what its own connector's `open` gave.
  return namespacesFor(records, contexts as NamespaceContexts);
}

// Every source's candidates for the overview, each with its source, from
// the index's records and change log across sources (decision 0027). Each
// source sees only its own.
export function candidatesFor(input: OverviewInput): (Candidate & { source: DeclaredKind })[] {
  const records = Map.groupBy(input.records, (record) => parseItemId(record.id)?.kind);
  const changes = Map.groupBy(input.changes, (entry) => kindOf(entry.source));
  return sourceKinds.flatMap((kind) =>
    sources[kind]
      .overview({
        records: records.get(kind) ?? [],
        changes: changes.get(kind) ?? [],
        held: input.held,
        now: input.now,
      })
      .map((candidate) => ({ ...candidate, source: kind })),
  );
}
