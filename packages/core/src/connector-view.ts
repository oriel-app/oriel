// How a connector shows in the window, as its declaration says and the server
// sends it, so the page keeps no list of sources (decision 0049).

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
