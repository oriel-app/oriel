// Every source, by kind, as it declares itself: the one list the composition
// root (packages/server) and the eval harness read. Adding a source adds it
// here, once; core's `sourceKinds` makes leaving one out a type error.
import {
  type IndexRecord,
  type NamespaceSpec,
  type OpSpecs,
  type SourceDeclaration,
  type SourceKind,
  sourceKinds,
} from "@oriel/core";
import { folderDeclaration } from "@oriel/folder";
import { jiraDeclaration } from "@oriel/jira";
import { slackDeclaration } from "@oriel/slack";

const declared = {
  jira: jiraDeclaration,
  folder: folderDeclaration,
  slack: slackDeclaration,
};

// Each source's declaration. It is also how each shows in the window
// (`Presentations`).
export const sources: Readonly<Record<SourceKind, SourceDeclaration>> = declared;

// One field of every source that declares it, in `sourceKinds` order.
function each<T>(
  field: (declaration: SourceDeclaration, kind: SourceKind) => T | undefined,
): Partial<Record<SourceKind, T>> {
  return Object.fromEntries(
    sourceKinds.flatMap((kind) => {
      const value = field(sources[kind], kind);
      return value === undefined ? [] : [[kind, value]];
    }),
  );
}

// What each source's items are, as bindings' `items` takes them.
export const itemDocs = each((declaration) => declaration.itemDoc);

// How change sets treat each writable source's ops.
export const specs: Partial<Record<SourceKind, OpSpecs>> = each((declaration) => declaration.specs);

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
): Partial<Record<SourceKind, NamespaceSpec>> {
  const given: Partial<Record<SourceKind, unknown>> = contexts;
  // `NamespaceContexts` gives each source the context its own namespace takes.
  return each((declaration, kind) => declaration.namespace?.(records, given[kind] as never));
}
