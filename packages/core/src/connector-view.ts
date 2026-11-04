// How a connector shows in the window, as its declaration says and the server
// sends it, so the page keeps no list of sources (decision 0049).
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
};

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
export type Presentation = Omit<ConnectorView, "kind"> & {
  details: DetailsOf;
  linked?: (link: URL) => string | null;
};
export type Presentations = Partial<Record<SourceKind, Presentation>>;
