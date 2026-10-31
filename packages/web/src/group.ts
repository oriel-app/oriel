// A group's page: its members, its threads, and asking about it, which
// opens a thread. Items are added from the window, or dropped here, and
// removed here.
import { type Dropped, type DropReply, dropNotice, isEmpty } from "./drop.ts";
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { GroupSummary, GroupView } from "./view.ts";

export type GroupModel = {
  id: string;
  view: GroupView | null;
  status: "loading" | "ready" | "failed";
  draft: string;
  // The name being edited, or null.
  name: string | null;
  pending: boolean;
  notice: string | null;
};

export type GroupMsg =
  | { type: "draftChanged"; text: string }
  | { type: "askClicked" }
  | { type: "memberRemoved"; id: string }
  | { type: "nameEdited"; name: string }
  | { type: "nameSaved" }
  | { type: "addClicked" }
  | { type: "dropped"; dropped: Dropped };

export function initGroup(id: string): [GroupModel, Effect[]] {
  return [
    { id, view: null, status: "loading", draft: "", name: null, pending: false, notice: null },
    [get(`/api/groups/${id}`, { kind: "group", id })],
  ];
}

export function updateGroup(model: GroupModel, msg: GroupMsg): [GroupModel, Effect[]] {
  switch (msg.type) {
    case "draftChanged":
      return [{ ...model, draft: msg.text }, []];
    case "askClicked": {
      const text = model.draft.trim();
      if (text === "" || model.pending) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/groups/${model.id}/threads`,
            { text },
            { kind: "threadOpened", groupId: model.id },
          ),
        ],
      ];
    }
    case "memberRemoved":
      if (model.pending) return [model, []];
      return [
        { ...model, pending: true, notice: null },
        [
          post(
            `/api/groups/${model.id}/remove`,
            { items: [msg.id] },
            { kind: "groupChanged", id: model.id },
          ),
        ],
      ];
    case "nameEdited":
      return [{ ...model, name: msg.name }, []];
    case "nameSaved": {
      const name = model.name?.trim();
      if (!name || name === model.view?.group.name) return [{ ...model, name: null }, []];
      return [
        { ...model, name: null },
        [post(`/api/groups/${model.id}/rename`, { name }, { kind: "renamed", id: model.id })],
      ];
    }
    case "addClicked":
      return [
        model,
        [{ type: "navigate", route: { page: "window", grouping: "epic", addTo: model.id } }],
      ];
    case "dropped":
      if (isEmpty(msg.dropped)) return [{ ...model, notice: nothingToAdd }, []];
      return [
        { ...model, notice: null },
        [post(`/api/groups/${model.id}/drop`, msg.dropped, { kind: "dropped", groupId: model.id })],
      ];
  }
}

export const nothingToAdd = "Nothing that was dropped names an item. Drop a Jira item or a file.";

export function groupReplied(model: GroupModel, msg: Replied): [GroupModel, Effect[]] {
  const { tag } = msg;
  switch (tag.kind) {
    case "group":
    case "groupChanged": {
      if (tag.id !== model.id) return [model, []];
      if (!msg.ok)
        return [
          {
            ...model,
            pending: false,
            status: model.view ? "ready" : "failed",
            notice: errorOf(msg.body),
          },
          [],
        ];
      return [{ ...model, view: msg.body as GroupView, status: "ready", pending: false }, []];
    }
    case "renamed": {
      if (tag.id !== model.id || model.view === null) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      return [{ ...model, view: { ...model.view, group: msg.body as GroupSummary } }, []];
    }
    case "dropped": {
      if (tag.groupId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, notice: errorOf(msg.body) }, []];
      const reply = msg.body as DropReply;
      return [{ ...model, view: reply.group, notice: dropNotice(reply) }, []];
    }
    case "threadOpened": {
      if (tag.groupId !== model.id) return [model, []];
      if (!msg.ok) return [{ ...model, pending: false, notice: errorOf(msg.body) }, []];
      const { id } = msg.body as { id: string };
      return [
        { ...model, pending: false, draft: "" },
        [{ type: "navigate", route: { page: "thread", id } }],
      ];
    }
    default:
      return [model, []];
  }
}
