// How a connector shows in the window, as its declaration says and the server
// sends it, so the page keeps no list of sources (decision 0049).
import type { ConnectOffer, ConnectStep, OptionField, ReviewStep } from "./connect.ts";
import type { SourceKind } from "./ids.ts";
import type { IndexRecord } from "./source.ts";

// Its items' icon, from a fixed set the window draws.
export const connectorIcons = ["ticket", "page", "message", "row"] as const;
export type ConnectorIcon = (typeof connectorIcons)[number];

// Browse's columns an item may fill beyond its key, title and status: its
// assignee, its estimate, and a chat message's replies. Each but the
// assignee is one of its connector's declared facets, which a test checks.
export const browseColumns = ["assignee", "estimate", "replies"] as const;
export type BrowseColumn = (typeof browseColumns)[number];

export type ConnectorView = {
  kind: string;
  // Its name as a person knows it, such as "Jira", and in a sentence, such
  // as "the folder".
  name: string;
  inSentence: string;
  icon: ConnectorIcon;
  // What its items' keys read as, such as "File", where a key means nothing
  // to a person; null where the key is what people read, as Jira's.
  keysReadAs: string | null;
  columns: readonly BrowseColumn[];
  // Whether it writes, so a connection of it may be read-only.
  writable: boolean;
  // How the window offers it; null where it doesn't.
  offer: ConnectOffer | null;
  // How a person makes a connection of it in the window, as the folder's;
  // null where only a flag or a source server makes one (decision 0059).
  connect: { steps: readonly ConnectStep[] } | null;
  // The words of the review step that drafts its options, which Settings
  // draws with its mapping (decision 0051); null where it has none.
  review: ReviewStep | null;
  // Its options, as Settings draws them.
  options: readonly OptionField[];
  // A stand-in's (decision 0059): the kinds it stands in for, and how the
  // window offers it while it's on; null for any other.
  standIn: StandIn | null;
};

// A stand-in, as its declaration gives it: the kinds whose connection turns
// it off, and its offer, which the first run and the overview show in their
// place while it's on.
export type StandIn = { for: readonly string[]; offer: ConnectOffer };

// What a source's items show in the window beyond core's fields: the
// source's own words for an item's type and status, and its labels. An
// adapter declares how to read them from its index records, and the
// composition root passes that in, by source kind. A source with none shows
// what core knows. `replies` counts the replies under a chat message, which
// are part of it.
export type ItemDetails = { type: string; status: string; labels: string[]; replies?: number };
export type DetailsOf = (record: IndexRecord) => ItemDetails | null;

// How a source shows in the window: its name, icon, keys and columns, which
// the server sends the page (`ConnectorView`), and its items' details.
// `linked` names the item, by its key, that a link into the source points at
// when the link isn't the item's location, such as a chat reply's link,
// which is its message's.
export type Presentation = Omit<
  ConnectorView,
  "kind" | "writable" | "offer" | "connect" | "review" | "options" | "standIn"
> & {
  details: DetailsOf;
  linked?: (link: URL) => string | null;
};
export type Presentations = Partial<Record<SourceKind, Presentation>>;
