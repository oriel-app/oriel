import type { StartQuestion } from "@oriel/core/window-chat";
import { type Effect, errorOf, get, post, report, type Replied } from "./http.ts";
import {
  aboutOf,
  looked,
  type LookingAt,
  type LookingMsg,
  type LookItem,
  notLooking,
  lookingReported,
  updateLooking,
} from "./looking.ts";
import { planQuestion, questionLabel, questionShort } from "./questions.ts";
import { initThread, type ThreadModel } from "./thread.ts";
import type { HeadlineView, OverviewView } from "./view.ts";

export type WindowChatModel = {
  draft: string;
  asking: boolean;
  asked: string | null;
  open: boolean;
  hiddenOnBrowse: boolean;
  problem: string | null;
  lookingAt: LookingAt;
};

export type WindowChatMsg =
  | { type: "draftChanged"; text: string }
  | { type: "askClicked" }
  | { type: "looking"; msg: LookingMsg }
  | { type: "questionPicked"; question: Question }
  | { type: "newChatClicked" }
  | { type: "closeClicked" }
  | { type: "openClicked" }
  | { type: "openAsThreadClicked" };

// `label` may hold a row's synced name, so only `text`, fixed wording, is sent. `text` names the overview headline,
// not the row: a sync between the click and the agent's read could move the headline to another row.
export type Question = {
  kind: StartQuestion;
  label: string;
  short?: string;
  text: string;
  subject?: string;
  headline?: HeadlineView["id"];
};

export const initWindowChat = (): WindowChatModel => ({
  draft: "",
  asking: false,
  asked: null,
  open: false,
  hiddenOnBrowse: false,
  problem: null,
  lookingAt: notLooking,
});

export const loadWindowChat: Effect = get("/api/window-chat", { kind: "windowChat" });

// A plan's question asks for the draft itself, so one click ends in a change set to approve rather than questions back.
export function questionsFrom(view: OverviewView, firstRun = false, plans = false): Question[] {
  if (plans && view.workstreams.length === 0 && view.candidates.total === 0)
    return [{ kind: "plan", label: planQuestion, short: planQuestion, text: planQuestion }];
  const headline = (id: string) => view.headlines.find((line) => line.id === id)?.subject;
  const moved = headline("moved");
  const quiet = headline("quiet");
  const top = headline("top");
  const topName =
    top?.kind === "item"
      ? (top.item.title ?? top.item.key)
      : top?.kind === "workstream"
        ? top.name
        : null;
  const topId = top?.kind === "item" ? top.item.id : top?.id;
  const label = (kind: StartQuestion, name = "") => questionLabel(kind, name) ?? "";
  const asked: (Question | null)[] = [
    view.changed.workstreams.length > 0
      ? {
          kind: "chart-moved",
          label: label("chart-moved"),
          short: questionShort("chart-moved"),
          text: "Chart what moved since I looked, by workstream",
          headline: "moved",
        }
      : null,
    moved?.kind === "workstream"
      ? {
          kind: "moved-most",
          label: label("moved-most", moved.name),
          short: questionShort("moved-most"),
          text: "What moved in the workstream that moved most since I looked?",
          headline: "moved",
          subject: moved.id,
        }
      : null,
    quiet?.kind === "workstream"
      ? {
          kind: "stalled",
          label: label("stalled", quiet.name),
          short: questionShort("stalled"),
          text: "Why has the workstream that's been quiet longest stalled?",
          headline: "quiet",
          subject: quiet.id,
        }
      : null,
    topName && topId && !firstRun
      ? {
          kind: "candidates",
          label: label("candidates", topName),
          short: questionShort("candidates"),
          text: "Should the top item not in a workstream yet become one?",
          headline: "top",
          subject: topId,
        }
      : null,
  ];
  const make: Question | null =
    firstRun && topName && top?.kind === "item"
      ? {
          kind: "make-candidate",
          label: label("make-candidate", topName),
          short: questionShort("make-candidate"),
          text: `Make a workstream of the top candidate in Not in a workstream yet, ${top.item.id}, with all its items.`,
          headline: "top",
          subject: top.item.id,
        }
      : null;
  return [make, ...asked].filter((question) => question !== null);
}

export type ChatState = { chat: WindowChatModel; thread: ThreadModel | null };

// The conversation stays on screen until the next question,
// so nothing the person was reading or pressing goes from under them.
export const chatThread = (thread: ThreadModel | null): ThreadModel | null =>
  thread?.view && !thread.view.windowChat ? null : thread;

export const movedOut = (thread: ThreadModel | null): boolean =>
  thread !== null && chatThread(thread) === null;

// A place in the old thread's entries means nothing in the new one.
export function handedOver(before: ThreadModel | null, after: ChatState): ChatState {
  const { thread, chat } = after;
  if (!thread || thread.id !== before?.id || movedOut(before) || !movedOut(thread)) return after;
  if (thread.draft === "" || chat.draft !== "") return after;
  const unplaced = (item: LookItem | null) => item && { ...item, under: null };
  const { lookingAt } = thread;
  return {
    thread: { ...thread, draft: "" },
    chat: {
      ...chat,
      draft: thread.draft,
      lookingAt: {
        chips: lookingAt.chips.map(({ item, on }) => ({ item: { ...item, under: null }, on })),
        offered: unplaced(lookingAt.offered),
        open: unplaced(lookingAt.open),
      },
    },
  };
}

const ask = (
  state: ChatState,
  text: string,
  used: Pick<Question, "kind" | "subject"> | null,
  looking = false,
): [ChatState, Effect[]] => {
  const trimmed = text.trim();
  if (trimmed === "" || state.chat.asking || chatThread(state.thread)?.view?.running)
    return [state, []];
  const about = looking ? aboutOf(state.chat.lookingAt) : undefined;
  return [
    { ...state, chat: { ...state.chat, asking: true, asked: trimmed, open: true, problem: null } },
    [
      post(
        "/api/window-chat/messages",
        { text: trimmed, about, ...(used ? { question: used } : {}) },
        { kind: "windowChatAsked" },
      ),
      ...(used ? [report({ name: "window-chat.question-used", question: used.kind })] : []),
    ],
  ];
};

export function updateWindowChat(state: ChatState, msg: WindowChatMsg): [ChatState, Effect[]] {
  const { chat } = state;
  switch (msg.type) {
    case "draftChanged":
      return [{ ...state, chat: { ...chat, draft: msg.text } }, []];
    case "askClicked":
      return ask(state, chat.draft, null, true);
    case "looking":
      return [
        { ...state, chat: { ...chat, lookingAt: updateLooking(chat.lookingAt, msg.msg) } },
        lookingReported(msg.msg),
      ];
    case "questionPicked":
      return ask(state, msg.question.text, {
        kind: msg.question.kind,
        ...(msg.question.subject ? { subject: msg.question.subject } : {}),
      });
    case "newChatClicked":
      return [
        { thread: null, chat: { ...chat, problem: null } },
        [
          ...(state.thread ? [{ type: "unsubscribe" } as const] : []),
          post("/api/window-chat/new", {}, { kind: "windowChatNew" }),
        ],
      ];
    case "closeClicked":
      return [{ ...state, chat: { ...chat, open: false } }, []];
    case "openClicked":
      return [{ ...state, chat: { ...chat, open: true } }, []];
    case "openAsThreadClicked": {
      const { thread } = state;
      if (thread === null) return [state, []];
      const moving = movedOut(thread)
        ? []
        : [post("/api/window-chat/open", { thread: thread.id }, { kind: "windowChatOpened" })];
      return [
        { ...state, chat: { ...chat, open: false } },
        [...moving, { type: "navigate", route: { page: "thread", id: thread.id } }],
      ];
    }
  }
}

function showing(state: ChatState, id: string | null): [ChatState, Effect[]] {
  if (id === state.thread?.id) return [state, []];
  const leaving: Effect[] = state.thread ? [{ type: "unsubscribe" }] : [];
  if (id === null) return [{ ...state, thread: null }, leaving];
  const [thread, effects] = initThread(id);
  return [{ ...state, thread }, [...leaving, ...effects]];
}

export function windowChatReplied(state: ChatState, msg: Replied): [ChatState, Effect[]] {
  switch (msg.tag.kind) {
    case "windowChat": {
      if (!msg.ok) return [state, []];
      const { thread } = msg.body as { thread: string | null };
      return showing(state, thread);
    }
    case "windowChatAsked": {
      const chat = { ...state.chat, asking: false, asked: null };
      if (!msg.ok) return [{ ...state, chat: { ...chat, problem: errorOf(msg.body) } }, []];
      const { id } = msg.body as { id: string };
      return showing(
        { ...state, chat: { ...chat, draft: "", lookingAt: looked(chat.lookingAt) } },
        id,
      );
    }
    case "windowChatOpened":
    case "windowChatNew":
      if (msg.ok) return [state, []];
      return [{ ...state, chat: { ...state.chat, problem: errorOf(msg.body) } }, [loadWindowChat]];
    default:
      return [state, []];
  }
}
