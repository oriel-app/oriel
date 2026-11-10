// The window chat (decisions 0027 and 0030): asked from the bar under the
// overview's counts strip, and answered beside the overview while it has a
// conversation. Its thread is the root's `thread` while the overview is on
// screen, so its chat, stream and change sets work as on a thread's page.
// Opening the overview makes nothing: the first question makes the thread,
// on a workstream of its own.
import type { StartQuestion } from "@oriel/core/window-chat";
import { type Effect, errorOf, get, post, report, type Replied } from "./http.ts";
import {
  aboutOf,
  looked,
  type LookingAt,
  type LookingMsg,
  notLooking,
  updateLooking,
} from "./looking.ts";
import { initThread, type ThreadModel } from "./thread.ts";
import type { OverviewView } from "./view.ts";

export type WindowChatModel = {
  // What the ask bar holds.
  draft: string;
  // A question sent from the bar and not yet answered.
  asking: boolean;
  // Whether the chat shows beside the overview. It opens with a question,
  // and closes back to the full-width overview.
  open: boolean;
  problem: string | null;
  // What the chat's first question is about: the item open beside it
  // (decision 0062). The ask bar sends none, as it shows none.
  lookingAt: LookingAt;
};

export type WindowChatMsg =
  | { type: "draftChanged"; text: string }
  // `chat`: from the chat's own field, which shows what it's looking at.
  | { type: "askClicked"; chat?: true }
  | { type: "looking"; msg: LookingMsg }
  | { type: "questionPicked"; question: Question }
  | { type: "newChatClicked" }
  | { type: "closeClicked" }
  | { type: "openClicked" };

// A question to start from (decision 0030): its kind, which telemetry
// counts by; its button's words, which may name its row; and the fixed
// wording sent, which never does. The row's name may be synced text, so it
// never becomes the user's words. The wording names the overview headline
// the button came from, and the agent reads that headline's subject, with
// its ID, in what window.overview() returns. It isn't the row's ID itself:
// a tool result can't go with a chat's first message yet, which Cite
// (OA-137) needs too, and a sync between the click and the read could move
// the headline to another row.
export type Question = { kind: StartQuestion; label: string; text: string };

export const initWindowChat = (): WindowChatModel => ({
  draft: "",
  asking: false,
  open: false,
  problem: null,
  lookingAt: notLooking,
});

// Which window chat the window shows, if any: the overview loads it.
export const loadWindowChat: Effect = get("/api/window-chat", { kind: "windowChat" });

// The questions to start from: the overview's own superlatives (the
// workstream that moved most since the user last looked, the one stalled
// longest, the top candidate), never generated. Questions about a cited row
// are Cite's (OA-137). On the first run, the top candidate's is first, and
// an instruction, "Make … a workstream", so what the agent does matches
// what was asked (decision 0038). Its name shows only on the button: the
// message is fixed wording and the row's ID, never its title. With `plans`,
// a stand-in is on (decision 0059), and while the window holds
// nothing yet, its one question asks for a plan to draft there, in words
// that ask for the draft itself, so one click ends in a change set to
// approve rather than questions back.
export const planQuestion = "Draft a small launch plan: one epic and a few stories I can edit";
export function questionsFrom(view: OverviewView, firstRun = false, plans = false): Question[] {
  if (plans && view.workstreams.length === 0 && view.candidates.total === 0)
    return [{ kind: "plan", label: planQuestion, text: planQuestion }];
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
  const asked: (Question | null)[] = [
    view.changed.workstreams.length > 0
      ? {
          kind: "chart-moved",
          label: "Chart what moved since I looked, by workstream",
          text: "Chart what moved since I looked, by workstream",
        }
      : null,
    moved?.kind === "workstream"
      ? {
          kind: "moved-most",
          label: `What moved in ${moved.name}?`,
          text: "What moved in the workstream that moved most since I looked?",
        }
      : null,
    quiet?.kind === "workstream"
      ? {
          kind: "stalled",
          label: `Why is ${quiet.name} stalled?`,
          text: "Why has the workstream that's been quiet longest stalled?",
        }
      : null,
    topName && !firstRun
      ? {
          kind: "candidates",
          label: `Should ${topName} become a workstream?`,
          text: "Should the top item not in a workstream yet become one?",
        }
      : null,
  ];
  const make: Question | null =
    firstRun && topName && top?.kind === "item"
      ? {
          kind: "make-candidate",
          label: `Make ${topName} a workstream`,
          text: `Make a workstream of the top candidate in Not in a workstream yet, ${top.item.id}, with all its items.`,
        }
      : null;
  return [make, ...asked].filter((question) => question !== null);
}

// The root's slice the window chat changes: its own model and the thread.
export type ChatState = { chat: WindowChatModel; thread: ThreadModel | null };

const ask = (
  state: ChatState,
  text: string,
  used: StartQuestion | null,
  looking = false,
): [ChatState, Effect[]] => {
  const trimmed = text.trim();
  if (trimmed === "" || state.chat.asking || state.thread?.view?.running) return [state, []];
  const about = looking ? aboutOf(state.chat.lookingAt) : undefined;
  return [
    { ...state, chat: { ...state.chat, asking: true, open: true, problem: null } },
    [
      post("/api/window-chat/messages", { text: trimmed, about }, { kind: "windowChatAsked" }),
      ...(used ? [report({ name: "window-chat.question-used", question: used })] : []),
    ],
  ];
};

export function updateWindowChat(state: ChatState, msg: WindowChatMsg): [ChatState, Effect[]] {
  const { chat } = state;
  switch (msg.type) {
    case "draftChanged":
      return [{ ...state, chat: { ...chat, draft: msg.text } }, []];
    case "askClicked":
      return ask(state, chat.draft, null, msg.chat === true);
    case "looking":
      return [
        { ...state, chat: { ...chat, lookingAt: updateLooking(chat.lookingAt, msg.msg) } },
        [],
      ];
    case "questionPicked":
      return ask(state, msg.question.text, msg.question.kind);
    // The old chat is marked done, or kept in Needs you while it waits on
    // the user; either way it leaves the window chat, which is empty until
    // the next question.
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
  }
}

// The window chat's thread, as the window now has it: kept if it is the one
// already shown, else loaded, which watches its stream once it has.
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
      const chat = { ...state.chat, asking: false };
      if (!msg.ok) return [{ ...state, chat: { ...chat, problem: errorOf(msg.body) } }, []];
      const { id } = msg.body as { id: string };
      return showing(
        { ...state, chat: { ...chat, draft: "", lookingAt: looked(chat.lookingAt) } },
        id,
      );
    }
    case "windowChatNew":
      if (msg.ok) return [state, []];
      return [{ ...state, chat: { ...state.chat, problem: errorOf(msg.body) } }, [loadWindowChat]];
    default:
      return [state, []];
  }
}
