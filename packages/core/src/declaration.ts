import type { DeclaredFacets } from "./change-log.ts";
import type { NamespaceSpec } from "./namespace.ts";
import type { OpSpecs } from "./ops.ts";
import type { OverviewOf } from "./overview.ts";
import type { PanelOf } from "./panel.ts";
import type { Recognizer } from "./references.ts";
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
export type SourceDeclaration<C = never, R = never> = Presentation & {
  // What its items are, in the declarations' `Item` (see `ItemDocs` in
  // bindings): shape only, never source text.
  itemDoc: string;
  // Its own view of one item, for the panel beside the page, from what a
  // live read returned.
  panel: PanelOf;
  // Its facets beyond the common ones (state, people, container), each with
  // its label, which the change log records (decision 0027). None is `{}`.
  facets: DeclaredFacets;
  // Its recognizer, for its own item IDs in any text (decision 0027), from
  // `R`, what only the composition root knows of it, such as the projects
  // it syncs. One that recognizes nothing returns none.
  recognizer: (context: R) => Recognizer;
  // Its candidates for the overview's Not in a workstream yet, each with its
  // rule and weight (decision 0027). One that finds none returns none.
  overview: OverviewOf;
  // Its namespace, from the index and `C`, what only the composition root
  // knows about it, such as where a new item goes.
  namespace?: (records: readonly IndexRecord[], context: C) => NamespaceSpec;
  specs?: OpSpecs;
};
