// A Noticed case's window: the fixtures' items as their syncs leave them,
// changed by the case's plants, with a change log of what the plants say a
// sync saw, and the case's workstreams. Everything is a function of the case,
// so a round replays.
import type { Evidence } from "@oriel/agent";
import {
  type ChangeLogEntry,
  type FixtureConnection,
  type Instant,
  type IndexRecord,
  type ItemId,
  instant,
  parseItemId,
  ulid,
  type WorkstreamMember,
} from "@oriel/core";
import { estimateKey, evidenceFacts, type SignalInput } from "@oriel/server/signals";
import { generated } from "../../../../scripts/big-world.ts";
import { type Fixtures, regionNamed } from "../fixtures.ts";
import type { NoticedCase } from "./case.ts";

export type NoticedWorld = {
  input: SignalInput;
  // Each item's title and text, as a read of its source gives them now.
  read: (ids: readonly ItemId[]) => Promise<Evidence[]>;
  // A case's name for a signal, as Oriel's signal ID.
  signalId: (ref: string) => string;
  // Workstream IDs by name, for a transcript.
  workstreamIds: ReadonlyMap<string, string>;
  close: () => void;
};

const day = 86_400_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// SYN's generated items, as an index holds them: `pnpm perf`'s big world.
function bigRecords(count: number, names: ReadonlyMap<string, string>): IndexRecord[] {
  const issues = generated(count);
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  return issues.map((issue): IndexRecord => {
    const epic = issue.epic ? byKey.get(issue.epic) : null;
    return {
      id: `jira:${issue.key}` as ItemId,
      stableId: issue.id,
      title: issue.summary,
      location: `https://oriel.atlassian.net/browse/${issue.key}`,
      updatedAt: issue.updatedAt as Instant,
      facets: {
        people: issue.assignee
          ? [
              {
                role: "assignee",
                id: issue.assignee,
                name: names.get(issue.assignee) ?? issue.assignee,
              },
            ]
          : [],
        state: issue.status.category,
        container: epic ? { id: `jira:${epic.key}` as ItemId, stableId: epic.id } : null,
        kind: issue.issueType === "Epic" ? "epic" : "story",
        estimate: issue.points,
      },
      attrs: {},
    };
  });
}

export async function buildNoticedWorld(
  evalCase: NoticedCase,
  fixtures: Fixtures,
): Promise<NoticedWorld> {
  const now = evalCase.at as Instant;
  const at = (daysAgo: number) => instant(new Date(Date.parse(now) - daysAgo * day));
  const connections = new Map<string, FixtureConnection>();
  for (const [kind, { loaded }] of fixtures) connections.set(kind, await loaded.connect(0));
  const close = () => {
    for (const connection of connections.values()) connection.close();
  };

  const records = new Map<string, IndexRecord>();
  for (const connection of connections.values())
    for (const record of connection.records) records.set(record.id, structuredClone(record));
  const names = new Map<string, string>();
  for (const record of records.values())
    for (const person of record.facets.people ?? []) names.set(person.id, person.name);

  if (evalCase.base === "big") {
    const grown = bigRecords(4000 - records.size, names);
    // Spread over the 60 days before the case's clock, as before SYN's.
    const shift = Date.parse(now) - Date.parse("2026-10-29T09:00:00.000Z");
    for (const record of grown)
      records.set(record.id, {
        ...record,
        updatedAt: instant(new Date(Date.parse(record.updatedAt) + shift)),
      });
  }
  if (evalCase.base === "fresh") {
    // Every item changed in the last week, and every chat message before
    // that, so no stall and no late message shows that the case didn't plant.
    [...records.values()].forEach((record, i) => {
      record.updatedAt =
        record.facets.kind === "message" ? at(10 + (i % 5)) : at(1 + ((i * 5) % 7));
    });
  }

  const texts = new Map<string, { title: string; text: string }>();
  const appended = new Map<string, string[]>();
  const changes: Omit<ChangeLogEntry, "seq">[] = [];
  const must = (name: string) => {
    const record = records.get(name);
    if (!record) throw new Error(`${evalCase.id}: no item ${name}`);
    return record;
  };
  const person = (id: string) => ({ role: "assignee", id, name: names.get(id) ?? id });
  const containerOf = (name: string) => {
    const epic = must(name);
    return { id: epic.id, stableId: epic.stableId };
  };
  const log = (record: IndexRecord, when: Instant, facets: ChangeLogEntry["facets"]) => {
    changes.push({
      source: parseItemId(record.id)?.prefix ?? "",
      stableId: record.stableId,
      version: 1,
      at: when,
      facets,
      gone: false,
    });
    if (when > record.updatedAt) record.updatedAt = when;
  };
  let messages = 0;
  const epicAndChildren = (name: string): string[] => {
    const epic = must(name);
    return [
      epic.id,
      ...[...records.values()]
        .filter((record) => record.facets.container?.stableId === epic.stableId)
        .map((record) => record.id),
    ];
  };

  for (const plant of evalCase.plants) {
    switch (plant.op) {
      case "set": {
        const record = must(plant.item);
        if (plant.state) record.facets.state = plant.state;
        if (plant.assignee) record.facets.people = [person(plant.assignee)];
        if (plant.estimate !== undefined) record.facets.estimate = plant.estimate;
        if (plant.epic) record.facets.container = containerOf(plant.epic);
        if (plant.daysAgo !== undefined) record.updatedAt = at(plant.daysAgo);
        break;
      }
      case "new": {
        const id = `jira:${plant.key}` as ItemId;
        records.set(id, {
          id,
          stableId: `9${plant.key.slice(4).padStart(5, "0")}`,
          title: plant.title,
          location: `https://oriel.atlassian.net/browse/${plant.key}`,
          updatedAt: at(plant.daysAgo),
          facets: {
            people: plant.assignee ? [person(plant.assignee)] : [],
            state: plant.state,
            container: plant.epic ? containerOf(plant.epic) : null,
            kind: plant.kind,
            estimate: plant.estimate ?? null,
          },
          attrs: {},
        });
        texts.set(id, { title: plant.title, text: plant.text ?? "" });
        break;
      }
      case "estimate": {
        const record = must(plant.item);
        const key = estimateKey(parseItemId(record.id)?.prefix ?? "") ?? "estimate";
        record.facets.estimate = plant.to;
        log(record, at(plant.daysAgo), {
          declared: { [key]: { before: plant.from, after: plant.to } },
        });
        break;
      }
      case "done": {
        const record = must(plant.item);
        const before = record.facets.state;
        record.facets.state = "done";
        log(record, at(plant.daysAgo), {
          state: { ...(before ? { before } : {}), after: "done" },
        });
        break;
      }
      case "join": {
        const after = containerOf(plant.epic);
        for (const name of plant.items) {
          const record = must(name);
          const before = record.facets.container ?? null;
          record.facets.container = after;
          log(record, at(plant.daysAgo), { container: { before, after } });
        }
        break;
      }
      case "message": {
        const when = at(plant.daysAgo);
        const ts = `${Math.floor(Date.parse(when) / 1000)}.${String(900 + messages++).padStart(6, "0")}`;
        const key = `C0FW1WEATHR-${ts}`;
        const id = `slack:${key}` as ItemId;
        const title = `${plant.author}: ${plant.text.slice(0, 60)}`;
        records.set(id, {
          id,
          stableId: key,
          title,
          location: `https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p${ts.replace(".", "")}`,
          updatedAt: when,
          facets: {
            kind: "message",
            references: plant.names.map((name) => {
              const named = must(name);
              return { id: named.id, stableId: named.stableId };
            }),
          },
          attrs: {},
        });
        texts.set(id, { title, text: plant.text });
        break;
      }
      case "quiet": {
        const region = plant.region ? regionNamed(fixtures, plant.region) : undefined;
        if (plant.region && !region) throw new Error(`${evalCase.id}: no region ${plant.region}`);
        const ids = [
          ...(region?.items ?? []),
          ...(plant.epic ? epicAndChildren(plant.epic) : []),
          ...(plant.items ?? []),
        ];
        ids.forEach((id, i) => {
          const record = records.get(id);
          if (record) record.updatedAt = at(plant.daysAgo + (i % 3));
        });
        break;
      }
      case "text": {
        must(plant.item);
        appended.set(plant.item, [...(appended.get(plant.item) ?? []), plant.append]);
        break;
      }
    }
  }

  const workstreams = evalCase.workstreams.map((workstream, i) => {
    const region = workstream.region ? regionNamed(fixtures, workstream.region) : undefined;
    if (workstream.region && !region)
      throw new Error(`${evalCase.id}: no region ${workstream.region}`);
    const ids = [
      ...(region?.items ?? []),
      ...(workstream.epic ? epicAndChildren(workstream.epic) : []),
      ...(workstream.items ?? []),
    ];
    const members = ids.flatMap((id): WorkstreamMember[] => {
      const record = records.get(id);
      // A region's item a fixture edit deleted is no member now.
      return record ? [{ id: record.id, stableId: record.stableId }] : [];
    });
    return {
      id: ulid(Date.parse(now), new Uint8Array(10).fill(i + 1)) as string,
      name: workstream.name,
      members,
    };
  });
  const workstreamIds = new Map(workstreams.map((w) => [w.name, w.id]));

  const all = [...records.values()];
  const input: SignalInput = {
    records: all,
    changes: changes
      .toSorted((a, b) => a.at.localeCompare(b.at))
      .map((entry, i) => ({ seq: i + 1, ...entry })),
    workstreams,
    threadActivity: new Map(),
    estimateKey,
    now,
  };

  const read = async (ids: readonly ItemId[]): Promise<Evidence[]> => {
    const fromSources = new Map<string, { title: string; text: string }>();
    for (const [kind, connection] of connections) {
      const own = ids.filter(
        (id) => parseItemId(id)?.kind === kind && !texts.has(id) && records.has(id),
      );
      const bigOnes = own.filter((id) => !connection.records.some((r) => r.id === id));
      for (const id of bigOnes)
        fromSources.set(id, {
          title: records.get(id)?.title ?? "",
          text: "What the story is for, in a sentence or two, as most of SYN's are.",
        });
      const read = await connection.read(own.filter((id) => !bigOnes.includes(id)));
      for (const result of read)
        if (result.status === "ok") {
          const content: unknown = result.content;
          const title = isRecord(content) && typeof content.title === "string" ? content.title : "";
          const body = isRecord(content) && typeof content.text === "string" ? content.text : "";
          fromSources.set(result.id, { title, text: body });
        }
    }
    const facts = new Map(evidenceFacts(input, ids).map((fact) => [fact.id as string, fact]));
    return ids.flatMap((id): Evidence[] => {
      const found = texts.get(id) ?? fromSources.get(id);
      if (!found) return [];
      const more = appended.get(id) ?? [];
      const { id: _id, ...rest } = facts.get(id) ?? { id };
      return [
        {
          id,
          facts: rest,
          title: found.title,
          text: [found.text, ...more].filter(Boolean).join("\n\n"),
        },
      ];
    });
  };

  const signalId = (ref: string) => {
    const colon = ref.indexOf(":");
    const kind = ref.slice(0, colon);
    const subject = ref.slice(colon + 1);
    if (!subject.startsWith("@")) return ref;
    const id = workstreamIds.get(subject.slice(1));
    if (!id) throw new Error(`${evalCase.id}: no workstream ${subject}`);
    return `${kind}:${id}`;
  };

  return { input, read, signalId, workstreamIds, close };
}
