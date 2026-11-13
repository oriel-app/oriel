import type { PreviewTable } from "./block.ts";
import type { DeclaredFacets } from "./change-log.ts";
import type { ConnectOf, ConnectOffer, OptionField, PreviewAsk, ReviewOf } from "./connect.ts";
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

export type SourceDeclaration<C = never, R = never, W = never> = Presentation & {
  // A short lowercase word, never one of Oriel's own spaces.
  kind: SourceKind;
  // Stricter than core's ID shape, with no text a person wrote; its sync refuses a record whose key doesn't match.
  key: RegExp;
  // Shape only, never source text.
  itemDoc: string;
  panel: PanelOf;
  facets: DeclaredFacets;
  recognizer: (context: R) => Recognizer;
  overview: OverviewOf;
  namespace?: (records: readonly IndexRecord[], context: C) => NamespaceSpec;
  specs?: OpSpecs;
  // A budget rises only in a reviewed change that says why.
  budget: number;
  // The writer itself is built only in packages/changeset.
  open: (connection: ToOpen, via: OpenVia) => Promise<Opened<Given<C>, Given<R>, Given<W>>>;
  // Its checks never quote a value.
  options: Described<Record<string, unknown>>;
  preview?: (connection: ToOpen, via: OpenVia, ask?: PreviewAsk) => Promise<PreviewTable[]>;
  review?: ReviewOf;
  optionFields?: readonly OptionField[];
  offer?: ConnectOffer;
  reads?(connection: { identity: string; options: Readonly<Record<string, unknown>> }): string;
  connect?: ConnectOf;
  standIn?: StandIn;
  takeIssues?: (issues: readonly TakenIssue[]) => {
    mutations: CapturedMutation[];
    items: Readonly<Record<NewRef, ItemId>>;
  };
  servers?: readonly SourceServer[];
  fixture: SourceFixture<Given<C>, Given<R>, Given<W>>;
};

export type TakenIssue = {
  id: ItemId;
  kind: "epic" | "story";
  summary: string;
  description: string;
  points: number | null;
  epic: ItemId | null;
};

type Given<T> = [T] extends [never] ? unknown : T;
