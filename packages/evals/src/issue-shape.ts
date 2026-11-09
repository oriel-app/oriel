// What a tracker's agent side gives, as text: its module in a few regions
// (none of its items, all of them, made around an epic, its stories alone,
// and its fixture's named regions), what its writes build or refuse, each
// op's line, fields and revert, its panel for every item, and what it makes
// of a stand-in's issues. Core's issue shape builds each tracker's agent side
// (OA-327), and a golden copy of this text, taken before it did, keeps every
// eval, budget and cassette where it was.
import { bindingsFor, type Namespaces } from "@oriel/bindings";
import {
  type ItemId,
  type NamespaceHost,
  type NamespaceWrite,
  type NewRef,
  parseItemId,
  type Reader,
  type Region,
  type SourceDeclaration,
  type TakenIssue,
  type WorkstreamOrigin,
} from "@oriel/core";
import type { Fixture } from "./fixtures.ts";
import { fixedId } from "./world.ts";

const regionOf = (
  ids: readonly ItemId[],
  origin: WorkstreamOrigin,
  stableId: (id: ItemId) => string,
): Region => ({
  workstreamId: fixedId,
  version: 1,
  workspaceId: fixedId,
  items: ids.map((id) => ({ id, stableId: stableId(id) })),
  origin,
});

const lines: string[] = [];
const say = (heading: string, value: unknown) =>
  lines.push(
    `## ${heading}`,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "",
  );

const tried = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return { threw: String(error) };
  }
};
const triedAsync = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    return await run();
  } catch (error) {
    return { threw: String(error) };
  }
};

export type Probes = {
  // Values each write's last parameter is tried with, by write name.
  values: Readonly<Record<string, readonly unknown[]>>;
  // A stand-in's issues for its takeIssues.
  taken: readonly TakenIssue[];
  // Arguments each op's line is tried with, by op name.
  args: Readonly<Record<string, readonly unknown[]>>;
};

export async function capture(kind: string, { declaration, loaded }: Fixture, probes: Probes) {
  lines.length = 0;
  const first = await loaded.connect(0);
  const connection =
    first.records.length > 0 || loaded.edits === 0
      ? first
      : (first.close(), await loaded.connect(loaded.edits));
  try {
    const d = declaration as SourceDeclaration<unknown>;
    const records = connection.records;
    const spec = d.namespace?.(records, connection.context);
    if (!spec) throw new Error(`${kind} has no namespace`);
    const namespaces: Namespaces = { [kind]: spec };
    const stableId = (id: ItemId) =>
      loaded.stableId?.(id) ??
      records.find((r) => r.id === id)?.stableId ??
      parseItemId(id)?.key ??
      "";
    const reader: Reader = { read: (ids) => connection.read(ids), search: async () => [] };
    const all = records.map((r) => r.id);
    const epics = records.filter((r) => r.facets.kind === "epic");
    const epic = epics[0];
    const children = epic
      ? records.filter((r) => r.facets.container?.stableId === epic.stableId).map((r) => r.id)
      : [];
    const regions: [string, ItemId[], WorkstreamOrigin][] = [
      ["blank", [], { kind: "picked" }],
      ["all", all, { kind: "picked" }],
      [
        "stories",
        records.filter((r) => r.facets.kind !== "epic").map((r) => r.id),
        { kind: "picked" },
      ],
      ...(epic
        ? ([
            [
              "around an epic",
              [epic.id, ...children],
              {
                kind: "cluster",
                grouping: "epic",
                cluster: epic.stableId,
                anchor: { id: epic.id, stableId: epic.stableId },
              },
            ],
          ] as [string, ItemId[], WorkstreamOrigin][])
        : []),
      ...loaded.regions.map((r): [string, ItemId[], WorkstreamOrigin] => [
        r.name,
        r.items,
        r.origin,
      ]),
    ];
    // The fixture's named regions are read as modules only.
    const named = new Set(loaded.regions.map((r) => r.name));
    say("item doc", d.itemDoc);
    for (const [name, ids, origin] of regions) {
      const region = regionOf(ids, origin, stableId);
      say(
        `module: ${name}`,
        bindingsFor(region, { reader, namespaces, items: { [kind]: d.itemDoc } }).dts,
      );
      if (named.has(name)) continue;
      const scope = {
        ids: ids.filter((id) => parseItemId(id)?.kind === kind).sort(),
        anchor: origin.kind === "cluster" && origin.anchor ? origin.anchor.id : null,
      };
      const created = new Map<NewRef, string>([
        ["new:1", Object.keys(spec.ops)[0] ?? ""],
        ["new:2", "nothing"],
      ]);
      const host: NamespaceHost = {
        has: (id): id is ItemId => ids.includes(id as ItemId),
        created,
        read: async (want, view) =>
          (await connection.read(want)).map((r) =>
            r.status === "ok"
              ? view(r.id, r.content)
              : { id: r.id, gone: true, reason: "deleted" as const },
          ),
      };
      const targets = [ids[0], ids.at(-1), "new:1", "new:3", "jira:SYN-1", `${kind}:NOPE-1`].filter(
        (each) => each !== undefined,
      );
      const result: Record<string, unknown> = {};
      for (const fn of spec.fns(scope)) {
        if (fn.kind === "read") {
          // Every item's view once, in the region of them all.
          if (fn.name === "listItems" && name !== "all") continue;
          result[fn.name] = await triedAsync(() =>
            fn.run(fn.params.length ? [ids[0] ?? `${kind}:NOPE-1`] : [], host),
          );
          continue;
        }
        const values = probes.values[fn.name] ?? [];
        const build = (args: unknown[]) => tried(() => (fn as NamespaceWrite).build(args, host));
        result[fn.name] =
          fn.params.length === 1
            ? values.map((value) => build([value]))
            : [
                ...targets.map((target) => build([target, values[0]])),
                ...values.slice(1).map((value) => build([targets[0], value])),
              ];
      }
      say(
        `fns: ${name}`,
        Object.entries(result)
          .flatMap(([fn, each]) =>
            Array.isArray(each)
              ? each.map((one) => `${fn} ${JSON.stringify(one)}`)
              : [`${fn} ${JSON.stringify(each)}`],
          )
          .join("\n"),
      );
    }
    const specs = d.specs;
    if (specs) {
      say("specs", {
        name: specs.name,
        titleField: specs.titleField,
        updatedField: specs.updatedField,
        fields: specs.fields,
      });
      const subjects = [
        null,
        { kind: "new" as const, ref: "new:1" as NewRef, title: null },
        { kind: "new" as const, ref: "new:1" as NewRef, title: "A  new\nthing" },
        { kind: "item" as const, id: all[0] ?? (`${kind}:X-1` as ItemId), title: null },
        { kind: "item" as const, id: all[0] ?? (`${kind}:X-1` as ItemId), title: "x".repeat(90) },
      ];
      const befores = [
        {},
        {
          summary: "Old",
          description: "Was",
          points: 1,
          estimate: 1,
          assignee: "Ada",
          status: "Todo",
          cycle: 3,
          epic: null,
          "label:urgent": true,
        },
        { description: "  ", points: 5, status: "In Progress", cycle: "x" },
      ];
      for (const [name, op] of Object.entries(specs.ops)) {
        const out: unknown[] = [];
        for (const args of probes.args[name] ?? []) {
          const entry: Record<string, unknown> = { args };
          entry.valid = op.args(args).ok;
          if (!entry.valid) {
            out.push(entry);
            continue;
          }
          entry.after = op.after(args);
          entry.refs = op.refs(args);
          entry.lines = [];
          for (const subject of subjects)
            for (const before of befores)
              (entry.lines as unknown[]).push(
                await op.describe(args, {
                  subject,
                  before,
                  name: async (id) => (id === "acct" ? "Ada" : null),
                  title: async (id) =>
                    id === "new:1" ? "Fresh epic" : id === all[0] ? "Known" : null,
                }),
              );
          entry.undo = befores.map((before) =>
            tried(() =>
              op.undo(args, {
                id: (all[0] ?? `${kind}:X-1`) as ItemId,
                before,
                after: {},
              } as never),
            ),
          );
          out.push(entry);
        }
        say(`op ${name}`, {
          creates: op.creates,
          makes: op.makes,
          deletes: op.deletes,
          idempotent: op.idempotent,
          revertOnly: op.revertOnly,
          newRefArgs: op.newRefArgs,
          probes: out,
        });
      }
    }
    const panels: Record<string, unknown> = {};
    for (const r of await connection.read(all))
      panels[r.id] = r.status === "ok" ? d.panel(r.content) : r.status;
    say("panels", panels);
    say(
      "panel of nothing",
      tried(() => d.panel({})),
    );
    if (d.takeIssues) say("takeIssues", d.takeIssues(probes.taken));
    return lines.join("\n");
  } finally {
    connection.close();
  }
}
