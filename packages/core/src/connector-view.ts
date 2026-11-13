import type { ConnectOffer, ConnectStep, OptionField, ReviewStep } from "./connect.ts";
import type { SourceKind } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

export const connectorIcons = ["ticket", "page", "message", "row"] as const;
export type ConnectorIcon = (typeof connectorIcons)[number];

export const browseColumns = ["assignee", "estimate", "replies"] as const;
export type BrowseColumn = (typeof browseColumns)[number];

export type ConnectorView = {
  kind: string;
  name: string;
  inSentence: string;
  icon: ConnectorIcon;
  keysReadAs: string | null;
  columns: readonly BrowseColumn[];
  writable: boolean;
  offer: ConnectOffer | null;
  connect: { steps: readonly ConnectStep[] } | null;
  review: ReviewStep | null;
  options: readonly OptionField[];
  standIn: StandIn | null;
};

export type StandIn = { for: readonly string[]; offer: ConnectOffer };

export type ItemDetails = { type: string; status: string; labels: string[]; replies?: number };
export type DetailsOf = (record: IndexRecord) => ItemDetails | null;

export type Presentation = Omit<
  ConnectorView,
  "kind" | "writable" | "offer" | "connect" | "review" | "options" | "standIn"
> & {
  details: DetailsOf;
  linked?: (link: URL) => string | null;
};
export type Presentations = Partial<Record<SourceKind, Presentation>>;
