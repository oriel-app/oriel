// Types only, importing nothing, so the web package can import it under its DOM-only config.

export type StatusCategory = "todo" | "in-progress" | "done";

export type ItemRow = {
  id: string;
  key: string;
  title: string;
  type: string;
  status: { name: string; category: StatusCategory } | null;
  assignee: string | null;
  points: number | null;
  noEstimates?: true;
  idleDays: number;
  replies?: { count: number; url: string };
};

export type ClusterRow = {
  key: string;
  label: string;
  origin: { kind: "source"; source: string } | { kind: "derived"; rule: string };
  anchor: ItemRow | null;
  count: number;
  size: number;
  points: number;
  estimated: number;
  unestimated: number;
  status: Record<StatusCategory, number>;
};
