import type { PreviewTable } from "./block.ts";
import type { DeclaredFacets } from "./change-log.ts";
import type { ConnectOf, LiveOf, OptionField, PreviewAsk, ReviewOf } from "./connect.ts";
import type { StandIn } from "./connector-view.ts";
import type { Presentation } from "./connector-view.ts";
import type { SourceFixture } from "./fixture.ts";
import type { ItemId, SourceKind } from "./ids.ts";
import type { CapturedMutation, NewRef } from "./sandbox.ts";
import type { NamespaceSpec } from "./namespace.ts";
import type { Opened, OpenVia, ToOpen } from "./open.ts";
import type { OpSpecs } from "./ops.ts";
import type { OverviewOf } from "./overview.ts";
import type { PanelOf } from "./panel.ts";
import type { Recognizer } from "./references.ts";
import type { IndexRecord } from "./source.ts";
import type { SourceServer } from "./servers.ts";
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
  // What the agent reads to draft those options, while a connection waits
  // for them or the person asks to change them (decision 0051): read live
  // from the source, as tables of text, such as a workspace's channels and
  // when each was last active. Without it, the agent drafts none of its
  // options. `ask` may name tables to read first, or ask for their names
  // alone, as Settings lists them (OA-232).
  preview?: (connection: ToOpen, via: OpenVia, ask?: PreviewAsk) => Promise<PreviewTable[]>;
  // How a draft of those options reads against the preview, which the agent
  // drafts in place of options, and Oriel's own guess. Without it, a draft
  // is options.
  review?: ReviewOf;
  // How Settings draws them, those it can.
  optionFields?: readonly OptionField[];
  // How a person makes a connection of it in the window: its steps and
  // their server halves. Without it, only a flag makes one.
  connect?: ConnectOf;
  // How a flag makes a live connection of it under `pnpm dev`, from `.env`.
  live?: LiveOf;
  // A stand-in's (decision 0059): the kinds whose connection turns it off,
  // and how the window offers it while it's on, in place of them, as a
  // connector's `connect.offer` does. It is on while none of them is
  // connected, opened over Oriel's own store of its items (`OpenVia.own`),
  // whose index rows are their source of truth, so nothing syncs it; while
  // one is, nothing of it shows, and its items stay, for when it's on again.
  standIn?: StandIn;
  // How it takes in a stand-in's issues once it's on (decision 0059): one
  // create of a change set for each, epics first, each story in its epic's
  // create, and the stand-in's item each create makes again, by its ref.
  // Absent: it takes in none, and the stand-in steps aside as it turns on.
  takeIssues?: (issues: readonly TakenIssue[]) => {
    mutations: CapturedMutation[];
    items: Readonly<Record<NewRef, ItemId>>;
  };
  // The source servers it reads its kind through (decision 0059): how each
  // is recognised among the person's agent's MCP servers, and the tools it
  // must offer. A person turns its kind on through one Oriel finds. None:
  // its kind turns on only through its connections, until its source
  // server's story.
  servers?: readonly SourceServer[];
  // Its synthetic data, which tests, evals and the server's fixture mode
  // connect to. Its connection gives the context its namespace takes; one
  // with no namespace, anything.
  fixture: SourceFixture<Given<C>, Given<R>, Given<W>>;
};

// A stand-in's issue, in the issues shape, as another tracker takes it in.
export type TakenIssue = {
  id: ItemId;
  kind: "epic" | "story";
  summary: string;
  description: string;
  points: number | null;
  epic: ItemId | null;
};

// What a declaration takes or gives where it declares nothing: anything.
type Given<T> = [T] extends [never] ? unknown : T;
