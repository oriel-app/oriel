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

export const connectorOf = (connectors: Connectors, id: string): ConnectorView | undefined =>
  connectors[kindOfItem(id) ?? ""];

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
