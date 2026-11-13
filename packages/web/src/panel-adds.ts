// Adds are kept whatever item the panel shows, so one in flight, or its Undo, can't go twice.
import { type Effect, errorOf, get, post, type Replied, undoing } from "./http.ts";
import { expiry, type Held, type Hold, hold, holding, notHeld, type Undos } from "./undos.ts";
import type { Undoable, UndoView, WorkstreamView } from "./view.ts";

export type PanelAdd = {
  item: string;
  key: string;
  workstreamId: string;
  name: string;
  pending: "add" | "undo" | null;
  done: { version: number; undo: UndoView | null } | null;
  shown: boolean;
  countdown: number;
  problem: string | null;
};

export type PanelAdds = { adds: readonly PanelAdd[]; held: Held; countdowns: number };

export const noAdds: PanelAdds = { adds: [], held: notHeld, countdowns: 0 };

export type AddOf = { item: string; workstreamId: string };

export type PanelAddMsg =
  | {
      type: "addClicked";
      item: { id: string; key: string };
      workstream: { id: string; name: string };
    }
  | ({ type: "undoClicked" } & AddOf)
  | ({ type: "undoExpired"; countdown: number } & AddOf)
  | ({ type: "problemDismissed" } & AddOf);

export type ShownWorkstream = { id: string; version: number; members: ReadonlySet<string> };

const same = (add: PanelAdd, of: AddOf) =>
  add.item === of.item && add.workstreamId === of.workstreamId;

export const addOf = (adds: PanelAdds, of: AddOf): PanelAdd | null =>
  adds.adds.find((each) => same(each, of)) ?? null;

export const undoable = (add: PanelAdd): add is PanelAdd & { done: { undo: UndoView } } =>
  add.shown && add.done?.undo != null;

const put = (adds: PanelAdds, add: PanelAdd): PanelAdds => ({
  ...adds,
  adds: [...adds.adds.filter((each) => !same(each, add)), add],
});

const drop = (adds: PanelAdds, of: AddOf): PanelAdds => ({
  ...adds,
  adds: adds.adds.filter((each) => !same(each, of)),
});

export function updateAdds(adds: PanelAdds, msg: PanelAddMsg): [PanelAdds, Effect[]] {
  switch (msg.type) {
    case "addClicked": {
      const { id, name } = msg.workstream;
      const of = { item: msg.item.id, workstreamId: id };
      if (addOf(adds, of)?.pending) return [adds, []];
      const add: PanelAdd = {
        ...of,
        key: msg.item.key,
        name,
        pending: "add",
        done: null,
        shown: false,
        countdown: 0,
        problem: null,
      };
      return [
        put(adds, add),
        [
          post(
            `/api/workstreams/${id}/add`,
            { items: [add.item] },
            { kind: "panelAdded", id: add.item, workstreamId: id, name },
          ),
        ],
      ];
    }
    case "undoClicked": {
      const add = addOf(adds, msg);
      if (!add || add.pending || !undoable(add)) return [adds, []];
      const tag = { kind: "panelAddUndone", id: add.item, workstreamId: add.workstreamId } as const;
      return [put(adds, { ...add, pending: "undo", problem: null }), [undoing(add.done.undo, tag)]];
    }
    case "undoExpired": {
      const add = addOf(adds, msg);
      if (!add || add.countdown !== msg.countdown || add.pending || holding(adds.held))
        return [adds, []];
      return [put(adds, { ...add, shown: false }), []];
    }
    case "problemDismissed": {
      const add = addOf(adds, msg);
      return add ? [put(adds, { ...add, problem: null }), []] : [adds, []];
    }
  }
}

function counted(adds: PanelAdds, add: PanelAdd): [PanelAdds, Effect[]] {
  const countdown = adds.countdowns + 1;
  const next = { ...add, countdown };
  const { item, workstreamId } = next;
  const ends = expiry({
    type: "panelAdd",
    msg: { type: "undoExpired", item, workstreamId, countdown },
  });
  return [put({ ...adds, countdowns: countdown }, next), undoable(next) ? [ends] : []];
}

export function holdAdds(adds: PanelAdds, by: Hold, held: boolean): [PanelAdds, Effect[]] {
  return hold(adds, by, held, (base) =>
    base.adds
      .filter((add) => undoable(add) && !add.pending)
      .reduce<[PanelAdds, Effect[]]>(
        ([now, effects], add) => {
          const [next, more] = counted(now, add);
          return [next, [...effects, ...more]];
        },
        [base, []],
      ),
  );
}

export function addsReplied(adds: PanelAdds, msg: Replied): [PanelAdds, Effect[]] {
  const { tag } = msg;
  if (tag.kind !== "panelAdded" && tag.kind !== "panelAddUndone") return [adds, []];
  const of = { item: tag.id, workstreamId: tag.workstreamId };
  const add = addOf(adds, of);
  if (add?.pending !== (tag.kind === "panelAdded" ? "add" : "undo")) return [adds, []];
  if (tag.kind === "panelAddUndone" && msg.ok) return [drop(adds, of), []];
  if (!msg.ok) {
    const failed = { ...add, pending: null, problem: errorOf(msg.body) };
    return tag.kind === "panelAddUndone" ? counted(adds, failed) : [put(adds, failed), []];
  }
  const { workstream, undo } = msg.body as Undoable<WorkstreamView>;
  return counted(adds, {
    ...add,
    pending: null,
    done: { version: workstream.version, undo },
    shown: undo !== null,
    problem: null,
  });
}

export const addsLeft = (adds: PanelAdds): PanelAdds => ({
  ...adds,
  adds: adds.adds.map((add) => (add.pending ? add : { ...add, shown: false, problem: null })),
  held: notHeld,
});

// A page showing an older version tells nothing, and neither does one shown while the add or
// its Undo is in flight: their answer does.
export function standingAdds(adds: PanelAdds, shown: ShownWorkstream): PanelAdds {
  let changed = false;
  const standing = adds.adds.flatMap((add) => {
    const { done } = add;
    if (done === null || add.pending || shown.id !== add.workstreamId) return [add];
    if (shown.version < done.version) return [add];
    if (shown.version === done.version && shown.members.has(add.item)) return [add];
    changed = true;
    return shown.members.has(add.item)
      ? [{ ...add, done: { ...done, version: shown.version } }]
      : [];
  });
  return changed ? { ...adds, adds: standing } : adds;
}

export function checkAdd(
  adds: PanelAdds,
  item: string,
  workstreams: readonly { id: string; version: number }[] | null,
): Effect[] {
  return adds.adds.flatMap((add) => {
    const listed = workstreams?.find((each) => each.id === add.workstreamId);
    const moved = add.item === item && add.done && listed && listed.version > add.done.version;
    return moved ? recheckAdd(add.workstreamId) : [];
  });
}

export const recheckAdd = (workstreamId: string): Effect[] => [
  get(`/api/workstreams/${workstreamId}`, { kind: "panelAddChecked", workstreamId }),
];

export const shownOf = (view: WorkstreamView): ShownWorkstream => ({
  id: view.workstream.id,
  version: view.workstream.version,
  members: new Set(view.members.map((member) => member.ref.id)),
});

export function addedText(add: PanelAdd): string | null {
  if (add.done === null) return null;
  return add.done.undo ? `Added to “${add.name}”.` : `Already in “${add.name}”.`;
}

export function addUndos(adds: PanelAdds, send: (msg: PanelAddMsg) => void): Undos {
  const of = ({ item, workstreamId }: PanelAdd): AddOf => ({ item, workstreamId });
  const notes = adds.adds.filter(undoable).map((add) => {
    const said = `Added ${add.key} to “${add.name}”.`;
    return {
      key: `added-${add.workstreamId}-${add.item}`,
      said,
      label: `Undo: ${said}`,
      onUndo: () => send({ type: "undoClicked", ...of(add) }),
      disabled: add.pending !== null,
    };
  });
  const failed = adds.adds.findLast((add) => add.problem !== null && add.done?.undo != null);
  const problem = failed && {
    said: `Couldn't undo adding ${failed.key}: ${failed.problem}`,
    onDismiss: () => send({ type: "problemDismissed", ...of(failed) }),
  };
  return { notes, problem: problem ?? null };
}
