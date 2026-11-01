import type { NamespaceSpec } from "./namespace.ts";
import type { OpSpecs } from "./ops.ts";
import type { IndexRecord } from "./source.ts";
import type { Presentation } from "./zoom.ts";

// Everything a source declares about itself, in one place (decision 0019):
// how it shows in the window, what its items are to the agent, and, for a
// writable source, its namespace in a region's module and how change sets
// treat its ops. Each adapter exports one; the composition root and the eval
// harness read them all from one list, by source kind. Something new a
// source shows is one more field here, not another list. An adapter writes its
// declaration `satisfies SourceDeclaration<C>`, so the list in
// packages/sources sees its namespace and asks for its context.
export type SourceDeclaration<C = never> = Presentation & {
  // What its items are, in the declarations' `Item` (see `ItemDocs` in
  // bindings): shape only, never source text.
  itemDoc: string;
  // Its namespace, from the index and `C`, what only the composition root
  // knows about it, such as where a new item goes.
  namespace?: (records: readonly IndexRecord[], context: C) => NamespaceSpec;
  specs?: OpSpecs;
};
