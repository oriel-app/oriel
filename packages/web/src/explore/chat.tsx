// Spike (window-explore), rounds 10 to 14: 0027's window chat, mocked. The
// server answers a fixed set of questions from the world (scripts/explore/
// ask.ts); no model. Each design places the same pieces differently: where
// you ask, where answers show, citing a row, pinning an answer.
import { type ComponentChildren, createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { Answer, Block, Cite, OverviewData } from "./data.ts";

export type Turn = { q: string; cites: Cite[]; answer: Answer | null; pin: string | null };

type Chat = {
  data: OverviewData;
  turns: Turn[];
  cites: Cite[];
  draft: string;
  open: boolean;
  setDraft(q: string): void;
  setOpen(open: boolean): void;
  send(q?: string): void;
  cite(c: Cite): void;
  uncite(c: Cite): void;
  pin(at: number): void;
  unpin(id: string): void;
  reset(): void;
};

const ChatContext = createContext<Chat | null>(null);
export const useChat = () => useContext(ChatContext);

const post = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<unknown>);

export function ChatProvider({
  data,
  refresh,
  children,
}: {
  data: OverviewData;
  refresh: () => void;
  children: ComponentChildren;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cites, setCites] = useState<Cite[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const chat: Chat = {
    data,
    turns,
    cites,
    draft,
    open,
    setDraft,
    setOpen,
    send(asked) {
      const q = (asked ?? draft).trim();
      if (q === "") return;
      const turn: Turn = { q, cites, answer: null, pin: null };
      const at = turns.length;
      setTurns([...turns, turn]);
      setDraft("");
      setCites([]);
      setOpen(true);
      void post("/api/explore/ask", { q, cites }).then((answer) => {
        setTurns((now) => now.map((t, i) => (i === at ? { ...t, answer: answer as Answer } : t)));
        if ((answer as Answer).made) refresh();
      });
    },
    cite(c) {
      if (!cites.some((x) => x.id === c.id)) setCites([...cites, c]);
      setOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-ask-input]")?.focus());
    },
    uncite(c) {
      setCites(cites.filter((x) => x.id !== c.id));
    },
    pin(at) {
      const turn = turns[at];
      if (!turn) return;
      void post("/api/explore/pin", { q: turn.q, cites: turn.cites }).then((reply) => {
        const id = (reply as { id: string }).id;
        setTurns((now) => now.map((t, i) => (i === at ? { ...t, pin: id } : t)));
        refresh();
      });
    },
    unpin(id) {
      void post("/api/explore/unpin", { id }).then(() => {
        setTurns((now) => now.map((t) => (t.pin === id ? { ...t, pin: null } : t)));
        refresh();
      });
    },
    reset() {
      setTurns([]);
      setCites([]);
      setDraft("");
    },
  };
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

// "Ask" on a row puts it into the chat, as 0027's Cite does.
export function CiteButton({ cite }: { cite: Cite }) {
  const chat = useChat();
  if (!chat) return null;
  return (
    <button
      type="button"
      class="x-cite"
      data-cite
      title={`Ask about ${cite.label}`}
      aria-label={`Ask about ${cite.label}`}
      onClick={() => chat.cite(cite)}
    >
      Ask
    </button>
  );
}

export function Composer({ placeholder = "Ask about your window" }: { placeholder?: string }) {
  const chat = useChat();
  if (!chat) return null;
  return (
    <form
      class="x-composer"
      data-ask
      onSubmit={(e) => {
        e.preventDefault();
        chat.send();
      }}
    >
      {chat.cites.map((c) => (
        <span key={c.id} class="x-chip" data-chip>
          {c.label}
          <button type="button" aria-label={`Remove ${c.label}`} onClick={() => chat.uncite(c)}>
            ×
          </button>
        </span>
      ))}
      <input
        data-ask-input
        type="text"
        placeholder={chat.cites.length > 0 ? "Ask about it" : placeholder}
        value={chat.draft}
        onInput={(e) => chat.setDraft(e.currentTarget.value)}
        onFocus={() => chat.setOpen(true)}
      />
      <button type="submit" class="x-send">
        Ask
      </button>
    </form>
  );
}

export function Suggestions({ cited = false }: { cited?: boolean }) {
  const chat = useChat();
  if (!chat) return null;
  // Round 14: with a row cited, questions about that row.
  const ws = cited && chat.cites.some((c) => c.kind === "workstream");
  const item = cited && chat.cites.some((c) => c.kind === "item");
  const asks = ws
    ? ["What's happening in it?", "Who has work in progress in it?"]
    : item
      ? ["Make a workstream of it"]
      : (chat.data.chat?.suggestions ?? []);
  return (
    <ul class="x-suggest" aria-label="Questions to start from">
      {asks.map((q) => (
        <li key={q}>
          <button type="button" data-suggest onClick={() => chat.send(q)}>
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Conversation({ empty }: { empty?: ComponentChildren }) {
  const chat = useChat();
  const end = useRef<HTMLDivElement>(null);
  const count = chat?.turns.length ?? 0;
  const done = chat?.turns.at(-1)?.answer !== null;
  useEffect(() => {
    end.current
      ?.closest(".x-conversation")
      ?.querySelector("[data-answer]:last-of-type")
      ?.scrollIntoView({ block: "start" });
  }, [count, done]);
  if (!chat) return null;
  return (
    <div class="x-conversation" ref={end}>
      {chat.turns.length === 0
        ? empty
        : chat.turns.map((turn, i) => <AnswerView key={i} turn={turn} at={i} />)}
    </div>
  );
}

function AnswerView({ turn, at }: { turn: Turn; at: number }) {
  const chat = useChat();
  const a = turn.answer;
  return (
    <article class="x-answer" data-answer>
      <p class="x-asked">
        {turn.cites.map((c) => (
          <span key={c.id} class="x-chip">
            {c.label}
          </span>
        ))}
        {turn.q}
      </p>
      {a === null ? (
        <p class="x-quiet">Reading the window…</p>
      ) : (
        <>
          <div class="x-said">
            {a.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {a.blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
          {a.made && <MadeNote made={a.made} />}
          {a.pin &&
            (turn.pin ? (
              <p class="x-pinned-note">
                Pinned to the overview{" "}
                <button type="button" class="quiet-action" onClick={() => chat?.unpin(turn.pin!)}>
                  Unpin
                </button>
              </p>
            ) : (
              <button
                type="button"
                class="quiet-action x-pin"
                data-pin
                onClick={() => chat?.pin(at)}
              >
                Pin to overview
              </button>
            ))}
        </>
      )}
    </article>
  );
}

function MadeNote({ made }: { made: NonNullable<Answer["made"]> }) {
  const [undone, setUndone] = useState(false);
  return (
    <p class="x-made-note" role="status">
      {undone ? (
        "Undone."
      ) : (
        <>
          <a href={`/workstreams/${made.id}`}>{made.name}</a> made, {made.size} items.{" "}
          <button
            type="button"
            class="quiet-action"
            onClick={() =>
              void post("/api/explore/unmake", { id: made.id }).then(() => setUndone(true))
            }
          >
            Undo
          </button>
        </>
      )}
    </p>
  );
}

export function BlockView({ block }: { block: Block }) {
  const read = <p class="x-read">Computed by Oriel from {block.read}</p>;
  switch (block.kind) {
    case "bars": {
      const max = Math.max(1, ...block.bars.map((b) => b.value));
      return (
        <figure class="x-block x-bars" data-block="bars">
          <figcaption>{block.title}</figcaption>
          <ol>
            {block.bars.map((b) => (
              <li key={b.label} title={`${b.label}: ${b.value} ${block.unit}`}>
                <span class="x-bar-label">{b.label}</span>
                <span class="x-bar-track">
                  <span class="x-bar" style={{ width: `${(b.value / max) * 100}%` }} />
                </span>
                <span class="x-bar-value">{b.value}</span>
              </li>
            ))}
          </ol>
          {block.more > 0 && <p class="x-quiet">and {block.more} more</p>}
          {read}
        </figure>
      );
    }
    case "table":
      return (
        <figure class="x-block" data-block="table">
          <table class="x-grid">
            <thead>
              <tr>
                {block.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} class={typeof cell === "number" ? "num" : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {read}
        </figure>
      );
    case "items":
      return (
        <figure class="x-block" data-block="items">
          <ul class="x-block-items">
            {block.rows.map((row) => (
              <li key={row.key}>
                <span class="key">{row.key}</span> {row.title}
                <span class="x-sub"> · {row.sub}</span>
              </li>
            ))}
          </ul>
          {read}
        </figure>
      );
  }
}

// Round 10: 0027 as written. A rail beside the overview, "Ask about your
// window", with the conversation above the composer. On a narrow window, the
// composer is a bar at the bottom and the conversation a sheet over the page.
export function Rail({ suggest = false }: { suggest?: boolean }) {
  const chat = useChat();
  if (!chat) return null;
  const busy = chat.turns.length > 0 || chat.cites.length > 0;
  return (
    <aside
      class="x-chat"
      data-mode="rail"
      data-open={chat.open || undefined}
      data-busy={busy || undefined}
      aria-label="Ask about your window"
    >
      <header class="x-chat-head">
        <span>Ask about your window</span>
        {chat.turns.length > 0 && (
          <button type="button" class="quiet-action" onClick={() => chat.reset()}>
            New chat
          </button>
        )}
        <button
          type="button"
          class="quiet-action x-chat-close"
          aria-label="Close"
          onClick={() => chat.setOpen(false)}
        >
          ×
        </button>
      </header>
      <Conversation
        empty={
          <div class="x-chat-empty">
            <p class="x-quiet">
              Ask about anything in your sources and workstreams. Answers come with the read they're
              from. Use Ask on any row to bring it in.
            </p>
            {suggest && <Suggestions />}
          </div>
        }
      />
      <Composer />
    </aside>
  );
}

// Round 11: asking starts from a bar at the top of the overview; answers open
// in a panel over the page's right side only while there is a conversation,
// so the overview keeps its full width at rest.
export function Panel() {
  const chat = useChat();
  if (!chat || !chat.open || chat.turns.length === 0) return null;
  return (
    <aside class="x-chat" data-mode="panel" data-open aria-label="Ask about your window">
      <header class="x-chat-head">
        <span>Ask about your window</span>
        <button type="button" class="quiet-action" onClick={() => chat.reset()}>
          New chat
        </button>
        <button
          type="button"
          class="quiet-action"
          aria-label="Close"
          onClick={() => chat.setOpen(false)}
        >
          ×
        </button>
      </header>
      <Conversation />
      <Composer placeholder="Ask a follow-up" />
    </aside>
  );
}

// Round 12: answers in place, under the ask bar at the top of the overview.
export function InlineAnswers() {
  const chat = useChat();
  if (!chat || chat.turns.length === 0) return null;
  return (
    <section class="x-inline-answers" data-section="answers" aria-label="Answers">
      <header class="x-chat-head">
        <span>Answers</span>
        <button type="button" class="quiet-action" onClick={() => chat.reset()}>
          Clear
        </button>
      </header>
      <Conversation />
    </section>
  );
}

// Round 12: pinned answers keep their form, their top five, in their own strip.
export function PinnedStrip({ data, top = 5 }: { data: OverviewData; top?: number }) {
  const chat = useChat();
  const pins = data.chat?.pins ?? [];
  if (pins.length === 0) return null;
  return (
    <section class="x-section x-pins" data-section="pinned" aria-label="Pinned">
      <h2 class="x-head">
        <span>Pinned</span>
        <span class="x-head-more x-quiet">rerun each time you look</span>
      </h2>
      <div class="x-pin-list">
        {pins.map((p) => (
          <div key={p.id} class="x-pin-card" data-pinned>
            <p class="x-pin-title">
              {p.title}
              {chat && (
                <button
                  type="button"
                  class="x-unpin"
                  aria-label={`Unpin ${p.title}`}
                  onClick={() => chat.unpin(p.id)}
                >
                  ×
                </button>
              )}
            </p>
            {p.block ? <BlockView block={trim(p.block, top)} /> : <p>{p.headline}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

const trim = (block: Block, top: number): Block =>
  block.kind === "bars"
    ? {
        ...block,
        bars: block.bars.slice(0, top),
        more: block.more + Math.max(0, block.bars.length - top),
      }
    : ({ ...block, rows: block.rows.slice(0, top) } as Block);
