// Below 1100, where the item panel lies over a conversation (decision
// 0025): the overview's window chat, or a thread's page. The conversation
// publishes its composer here, and the panel carries it in a dock at its
// foot (`PanelDock`, item-panel.tsx), under the latest answer's first two
// lines, so the person can ask about the item without closing it. "Chat"
// gives the conversation the screen, and the item folds to a line above
// its composer (`FoldedItem`), with Show and ×. One context for both
// conversations, so there's one path from either to the panel.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Composer } from "./chat-input.tsx";
import { Tooltip } from "./tooltip.tsx";
import { entriesOf } from "./thread.ts";
import type { ThreadView } from "./view.ts";

export type PanelDock = {
  // The conversation's composer, as it draws it itself.
  composer: Composer;
  // The conversation's thread, once it has one, for its latest answer.
  view: ThreadView | null;
  // A first question on its way, before there's a thread, as sent.
  asked: string | null;
  // Folded: the conversation has the screen, and the item is a line.
  folded: boolean;
  item: { key: string; title: string | null };
  onFold(folded: boolean): void;
  onClose(): void;
};

export const PanelDockContext = createContext<PanelDock | null>(null);

// What the dock shows of the conversation: the latest answer; or, sent and
// not yet answered, the person's message, with the agent at work.
export type Latest = { kind: "answer"; text: string } | { kind: "sent"; text: string } | null;

export function latestOf(view: ThreadView | null): Latest {
  const entries = view ? entriesOf(view.entries) : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.kind === "reply") return { kind: "answer", text: entry.text };
    if (entry?.kind === "user") return { kind: "sent", text: entry.text };
  }
  return null;
}

// The item, folded to a line above the conversation's composer: Show puts it
// back over the conversation, and × closes it.
export function FoldedItem() {
  const dock = useContext(PanelDockContext);
  if (!dock?.folded) return null;
  const { key, title } = dock.item;
  return (
    <div class="panel-folded" role="group" aria-label="The item open">
      <span class="panel-folded-name">
        <b>{key}</b>
        {title && ` ${title}`}
      </span>
      <button
        type="button"
        class="quiet-action"
        aria-label={`Show ${key}`}
        onClick={() => dock.onFold(false)}
      >
        Show
      </button>
      <Tooltip text="Close">
        <button
          type="button"
          class="panel-folded-close"
          aria-label={`Close ${key}`}
          onClick={dock.onClose}
        >
          ×
        </button>
      </Tooltip>
    </div>
  );
}
