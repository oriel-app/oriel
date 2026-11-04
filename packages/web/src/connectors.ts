// How every connector shows, by kind, as its declaration says and the server
// sends it, loaded once (decision 0049): its name, its name in a sentence,
// its icon, what its keys read as and Browse's columns its items fill. The
// page keeps no list of sources; one it hasn't heard of shows as core knows
// an item, by its key.
import { type Effect, get, type Replied } from "./http.ts";
import { kindOfItem } from "./item-id.ts";
import type { ConnectorView, ItemRow } from "./view.ts";

export type Connectors = Readonly<Record<string, ConnectorView>>;

export const loadConnectors: Effect = get("/api/connectors", { kind: "connectors" });

export const noConnectors: Connectors = {};

export function connectorsReplied(model: Connectors, msg: Replied): Connectors {
  if (!msg.ok) return model;
  const { connectors } = msg.body as { connectors: ConnectorView[] };
  return Object.fromEntries(connectors.map((connector) => [connector.kind, connector]));
}

// The connector of an item, by its ID, whichever connection it is from.
export const connectorOf = (connectors: Connectors, id: string): ConnectorView | undefined =>
  connectors[kindOfItem(id) ?? ""];

// Which of Browse's columns an item fills, as its connector declares: an
// item with no assignee or estimate to lack leaves them empty (decisions 0019
// and 0021), and one whose board takes no estimates carries none either. A
// chat message shows its replies where an assignee would be.
export function columnsOf(
  connectors: Connectors,
  item: Pick<ItemRow, "id" | "noEstimates">,
): { assignee: boolean; estimate: boolean; replies: boolean } {
  const columns = connectorOf(connectors, item.id)?.columns ?? [];
  return {
    assignee: columns.includes("assignee"),
    estimate: columns.includes("estimate") && !item.noEstimates,
    replies: columns.includes("replies"),
  };
}
