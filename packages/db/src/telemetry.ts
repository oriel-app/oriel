// Pilot telemetry, stored locally (SPEC §7). Only raw events are kept;
// metrics such as the onboarding budget are derived from them when read.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  object,
  refine,
  string,
  type TelemetryEvent,
  type Ulid,
} from "@oriel/core";

const eventRow = object({
  name: string,
  at: refine(string, isInstant, "expected an instant"),
  data: string,
});

export type StoredEvent = { name: string; at: Instant; data: Record<string, unknown> };

export type TelemetryStore = ReturnType<typeof telemetryStore>;

export function telemetryStore(db: DatabaseSync) {
  const insert = db.prepare(
    "insert into telemetry_events (id, workspace_id, name, at, data) values (?, ?, ?, ?, ?)",
  );
  const select = db.prepare(
    "select name, at, data from telemetry_events where workspace_id = ? order by at, rowid",
  );
  return {
    record(event: TelemetryEvent, id: Ulid): void {
      const { name, at, workspaceId, ...data } = event;
      insert.run(id, workspaceId, name, at, JSON.stringify(data));
    },

    // A workspace's events, oldest first.
    list(workspaceId: Ulid): StoredEvent[] {
      return select.all(workspaceId).map((raw) => {
        const row = eventRow(raw);
        if (!row.ok) throw new Error(`corrupt telemetry row: ${JSON.stringify(row.issues)}`);
        const data: unknown = JSON.parse(row.value.data);
        return {
          name: row.value.name,
          at: row.value.at,
          data: typeof data === "object" && data !== null ? { ...data } : {},
        };
      });
    },
  };
}
