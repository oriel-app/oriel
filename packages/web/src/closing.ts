// Closing a thread from any list of threads, without opening it: marking it
// done, as its page's button does, or deleting it, which asks once first and
// says what deleting would lose. What else must reload once one closes is
// the app's to say (root.ts).
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { DeletedView, DeletionView } from "./view.ts";

// Where the person closed it from: a menu on the thread's row.
export type CloseVia = "menu";

export type ClosingModel = {
  // The thread the person asked to delete, until they confirm or cancel, and
  // what deleting it would lose, once the server says.
  asking: { threadId: string; title: string; via: CloseVia; deletion: DeletionView | null } | null;
  // Threads with a request in flight.
  pending: readonly string[];
  // What the last request said, when it failed.
  problem: string | null;
};

export type ClosingMsg =
  | { type: "markDoneClicked"; threadId: string; via: CloseVia }
  | { type: "deleteClicked"; threadId: string; title: string; via: CloseVia }
  | { type: "deleteConfirmed" }
  | { type: "deleteCancelled" }
  | { type: "problemDismissed" };

export const initClosing = (): ClosingModel => ({ asking: null, pending: [], problem: null });

export function updateClosing(model: ClosingModel, msg: ClosingMsg): [ClosingModel, Effect[]] {
  switch (msg.type) {
    case "markDoneClicked": {
      const { threadId, via } = msg;
      if (model.pending.includes(threadId)) return [model, []];
      return [
        { ...model, pending: [...model.pending, threadId], problem: null },
        [post(`/api/threads/${threadId}/done`, { via }, { kind: "markedDone", threadId })],
      ];
    }
    case "deleteClicked": {
      const { threadId, title, via } = msg;
      if (model.pending.includes(threadId)) return [model, []];
      return [
        { ...model, asking: { threadId, title, via, deletion: null }, problem: null },
        [get(`/api/threads/${threadId}/deletion`, { kind: "deletion", threadId })],
      ];
    }
    case "deleteConfirmed": {
      const { asking } = model;
      // Only once the person has been told what it would lose.
      if (asking?.deletion == null || model.pending.includes(asking.threadId)) return [model, []];
      const { threadId, via } = asking;
      return [
        { ...model, pending: [...model.pending, threadId], problem: null },
        [post(`/api/threads/${threadId}/delete`, { via }, { kind: "deleted", threadId })],
      ];
    }
    case "deleteCancelled":
      return [{ ...model, asking: null, problem: null }, []];
    case "problemDismissed":
      return [{ ...model, problem: null }, []];
  }
}

// The server's replies to these requests.
export function closingReplied(model: ClosingModel, msg: Replied): ClosingModel {
  const { tag } = msg;
  if (tag.kind !== "markedDone" && tag.kind !== "deletion" && tag.kind !== "deleted") return model;
  const pending = model.pending.filter((id) => id !== tag.threadId);
  const ours = model.asking?.threadId === tag.threadId;
  switch (tag.kind) {
    case "markedDone":
      return { ...model, pending, problem: msg.ok ? null : errorOf(msg.body) };
    case "deletion":
      if (!ours || model.asking === null) return model;
      return msg.ok
        ? { ...model, asking: { ...model.asking, deletion: msg.body as DeletionView } }
        : { ...model, problem: errorOf(msg.body) };
    case "deleted":
      if (!msg.ok) return { ...model, pending, problem: errorOf(msg.body) };
      return { ...model, pending, asking: ours ? null : model.asking, problem: null };
  }
}

// What a delete reply says happened.
export const deletedOf = (msg: Replied): DeletedView | null =>
  msg.ok && msg.tag.kind === "deleted" ? (msg.body as DeletedView) : null;

const sourceNames: Record<string, string> = { jira: "Jira", folder: "the folder", slack: "Slack" };

// What the person is told before deleting: what goes, and what deleting
// would lose that the source keeps.
export function deletionWarning(deletion: DeletionView): string {
  const { applied, reverted, unconfirmed, sources } = deletion;
  const where =
    sources.length === 0
      ? "its source"
      : sources.map((source) => sourceNames[source] ?? source).join(" and ");
  if (applied === 0 && unconfirmed === 0)
    return reverted === 0
      ? "Its chat and any change sets not applied go for good."
      : `What it changed in ${where} was reverted. Its chat goes for good.`;
  const made =
    applied === 0
      ? `It sent ${changes(unconfirmed)} to ${where} with no answer, so ${unconfirmed === 1 ? "it" : "they"} may have been made.`
      : `It made ${changes(applied)} in ${where}${unconfirmed > 0 ? `, and may have made ${unconfirmed} more` : ""}.`;
  const them = applied + unconfirmed === 1 ? "it" : "them";
  return `${made} After deleting the thread you can no longer revert ${them} from Oriel.`;
}

const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`);
