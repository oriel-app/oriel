import type { DeclaredFacets } from "./change-log.ts";
import type { ConnectOf, LiveOf } from "./connect.ts";
import type { Presentation } from "./connector-view.ts";
import type { SourceFixture } from "./fixture.ts";
import type { SourceKind } from "./ids.ts";
import type { NamespaceSpec } from "./namespace.ts";
import type { Opened, OpenVia, ToOpen } from "./open.ts";
import type { OpSpecs } from "./ops.ts";
import type { OverviewOf } from "./overview.ts";
import type { PanelOf } from "./panel.ts";
import type { Recognizer } from "./references.ts";
import type { IndexRecord } from "./source.ts";
import type { Described } from "./validate.ts";

// Everything a source declares about itself, in one place (decision 0019):
// how it shows in the window, what its items are to the agent, and, for a
// writable source, its namespace in a region's module and how change sets
// treat its ops. Each adapter exports one; the composition root and the eval
// harness read them all from one list, by source kind. Something new a
// source shows is one more field here, not another list. An adapter writes its
// declaration `satisfies SourceDeclaration<C>`, so the list in
// packages/sources sees its namespace and asks for its context. `W` is what
// its writer is built from, for a writable source.
export type SourceDeclaration<C = never, R = never, W = never> = Presentation & {
  // Its name in item IDs and in the agent's module, such as `jira`: a short
  // lowercase word, never one of Oriel's own spaces (decision 0049).
  kind: SourceKind;
  // Its items' key shape, stricter than core's for every ID, with no text a
  // person wrote. Its sync refuses a record whose key doesn't match.
  key: RegExp;
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
  // Bytes its item doc and its namespace, connected to its fixture, may add
  // to a region's module, without the region's ID lines (OA-26). A budget
  // rises only in a reviewed change that says why.
  budget: number;
  // How it opens a connection: its source, its recognizer's scope, its
  // namespace's context and what its writer is built from, from the
  // connection's options and its secret (decision 0049). The writer itself
  // is built only in packages/changeset (decision 0003).
  open: (connection: ToOpen, via: OpenVia) => Promise<Opened<Given<C>, Given<R>, Given<W>>>;
  // What a person sets per connection, which `source.configure` checks
  // with it: the options its `open` reads. Its checks never quote a value.
  options: Described<Record<string, unknown>>;
  // How a person makes a connection of it in the window: its steps and
  // their server halves. Without it, only a flag makes one.
  connect?: ConnectOf;
  // How a flag makes a live connection of it under `pnpm dev`, from `.env`.
  live?: LiveOf;
  // Its synthetic data, which tests, evals and the server's fixture mode
  // connect to. Its connection gives the context its namespace takes; one
  // with no namespace, anything.
  fixture: SourceFixture<Given<C>, Given<R>, Given<W>>;
};

// What a declaration takes or gives where it declares nothing: anything.
type Given<T> = [T] extends [never] ? unknown : T;
