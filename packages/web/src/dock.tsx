import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Composer } from "./chat-input.tsx";
import { Tooltip } from "./tooltip.tsx";
import { entriesOf } from "./thread.ts";
import type { ThreadView } from "./view.ts";

export type PanelDock = {
  composer: Composer;
  view: ThreadView | null;
  asked: string | null;
  folded: boolean;
  item: { key: string; title: string | null };
  onFold(folded: boolean): void;
  onClose(): void;
};

export const PanelDockContext = createContext<PanelDock | null>(null);

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
