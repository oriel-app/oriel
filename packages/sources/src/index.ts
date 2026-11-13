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

// An untagged create, from before migration 0031, goes to the first kind whose catalogue has its op,
// so Linear comes after Jira, and the stand-in tracker last.
const declared = {
  jira: jiraDeclaration,
  linear: linearDeclaration,
  folder: folderDeclaration,
  slack: slackDeclaration,
  sheets: sheetsDeclaration,
  tracker: trackerDeclaration,
};

export type DeclaredKind = keyof typeof declared;

export const sources: Readonly<Record<DeclaredKind, SourceDeclaration>> = declared;

export const sourceKinds = Object.keys(declared) as readonly DeclaredKind[];

const isDeclared = (kind: string): kind is DeclaredKind => Object.hasOwn(declared, kind);

export const declarationOf = (kind: string): SourceDeclaration | undefined =>
  isDeclared(kind) ? sources[kind] : undefined;

export function parseDeclared(id: string): (ParsedItemId & { kind: DeclaredKind }) | null {
  const parsed = parseItemId(id);
  if (!parsed || !isDeclared(parsed.kind) || !sources[parsed.kind].key.test(parsed.key))
    return null;
  return { ...parsed, kind: parsed.kind };
}

export const byItemId = itemOrder(sourceKinds);

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

export const knownServers: readonly { kind: DeclaredKind; server: SourceServer }[] =
  sourceKinds.flatMap((kind) => (sources[kind].servers ?? []).map((server) => ({ kind, server })));

export const itemDocs = each((declaration) => declaration.itemDoc);

export const specs: Partial<Record<DeclaredKind, OpSpecs>> = each(
  (declaration) => declaration.specs,
);

type ContextOf<D> = D extends { namespace: (records: never, context: infer C) => NamespaceSpec }
  ? C
  : never;

type Declared = typeof declared;
type Needs<K extends keyof Declared> = ContextOf<Declared[K]>;

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

export function namespacesFor(
  records: readonly IndexRecord[],
  contexts: NamespaceContexts,
): Partial<Record<DeclaredKind, NamespaceSpec>> {
  const given: Partial<Record<DeclaredKind, unknown>> = contexts;
  return each((declaration, kind) => declaration.namespace?.(records, given[kind] as never));
}

type ScopeOf<D> = D extends { recognizer: (context: infer R) => Recognizer } ? R : never;

export type RecognizerScopes = {
  [K in keyof Declared as [ScopeOf<Declared[K]>] extends [never] ? never : K]?: ScopeOf<
    Declared[K]
  >;
};

export function recognizerFor(scopes: RecognizerScopes): Recognizer {
  const given: Partial<Record<DeclaredKind, unknown>> = scopes;
  return recognizeAll(
    sourceKinds.flatMap((kind) =>
      kind in given ? [sources[kind].recognizer(given[kind] as never)] : [],
    ),
  );
}

export type OpenSource = { kind: string; opened: Opened };

const firstOpen = (open: readonly OpenSource[]): Partial<Record<DeclaredKind, Opened>> =>
  Object.fromEntries(
    sourceKinds.flatMap((kind) => {
      const found = open.find((each) => each.kind === kind);
      return found ? [[kind, found.opened]] : [];
    }),
  );

export function recognizerOf(open: readonly OpenSource[]): Recognizer {
  const scopes = Object.fromEntries(
    Object.entries(firstOpen(open)).map(([kind, opened]) => [kind, opened.scope]),
  );
  return recognizerFor(scopes as RecognizerScopes);
}

export function namespacesOf(
  records: readonly IndexRecord[],
  open: readonly OpenSource[],
): Partial<Record<DeclaredKind, NamespaceSpec>> {
  const contexts = Object.fromEntries(
    Object.entries(firstOpen(open)).map(([kind, opened]) => [kind, opened.context()]),
  );
  return namespacesFor(records, contexts as NamespaceContexts);
}

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
