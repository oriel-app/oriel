// The window chat on screen (decisions 0027 and 0030): the ask bar under the
// overview's counts strip, with questions to start from, and the chat beside
// the overview while it has a conversation, over the page's right side, or
// as a sheet on a narrow window. The item panel covers it while an item is
// open. Its entries render as a thread's page renders them, blocks included.
import { useEffect, useRef } from "preact/hooks";
import { type Dispatch, ItemLinksContext, Link } from "./parts.tsx";
import { entriesOf, expected, type ThreadModel, type ThreadMsg } from "./thread.ts";
import { ChatEntryItem, Composer, itemsOf } from "./thread-page.tsx";
import type { OverviewView } from "./view.ts";
import { questionsFrom, type WindowChatModel, type WindowChatMsg } from "./window-chat.ts";

export function AskBar(props: {
  chat: WindowChatModel;
  view: OverviewView | null;
  // Whether there is a conversation to go back to, behind a closed chat.
  ongoing: boolean;
  // The first run's overview, whose top question is an instruction.
  firstRun?: boolean;
  // No AI is set up, so the bar says so and opens Settings (decision 0038).
  noAi?: boolean;
  dispatch: Dispatch;
}) {
  const { chat, view, ongoing, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  if (props.noAi)
    return (
      <section class="ask" aria-label="Ask about your window">
        <div class="ask-bar" data-off>
          <input
            type="text"
            class="ask-input"
            disabled
            placeholder="Set up Claude to ask about your window"
            aria-label="Set up Claude to ask about your window"
          />
          <Link
            route={{ page: "settings", section: "providers" }}
            dispatch={dispatch}
            class="button primary"
          >
            Set up
          </Link>
        </div>
      </section>
    );
  const questions = view ? questionsFrom(view, props.firstRun === true) : [];
  return (
    <section class="ask" aria-label="Ask about your window">
      <form
        class="ask-bar"
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: "askClicked" });
        }}
      >
        <input
          type="text"
          class="ask-input"
          value={chat.draft}
          placeholder="Ask about your window"
          aria-label="Ask about your window"
          onInput={(event) => send({ type: "draftChanged", text: event.currentTarget.value })}
        />
        <button
          type="submit"
          class="button primary"
          disabled={chat.asking || chat.draft.trim() === ""}
        >
          Ask
        </button>
        {ongoing && !chat.open && (
          <button type="button" class="quiet-action" onClick={() => send({ type: "openClicked" })}>
            Back to the chat
          </button>
        )}
      </form>
      {questions.length > 0 && (
        <ul class="ask-questions" aria-label="Questions to start from">
          {questions.map((question) => (
            <li key={question.kind}>
              <button
                type="button"
                class="ask-question"
                disabled={chat.asking}
                onClick={() => send({ type: "questionPicked", question })}
              >
                {question.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chat.problem && !chat.open && (
        <p class="ask-problem" role="alert">
          {chat.problem}
        </p>
      )}
    </section>
  );
}

export function WindowChat(props: {
  chat: WindowChatModel;
  thread: ThreadModel | null;
  dispatch: Dispatch;
}) {
  const { chat, thread, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  const sendThread = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
  const view = thread && expected(thread);
  const entries = view?.entries.length ?? 0;
  const list = useRef<HTMLOListElement>(null);
  // Each new entry, and the agent at work, shows at the chat's end.
  useEffect(() => {
    const end = list.current;
    if (end) end.scrollTop = end.scrollHeight;
  }, [entries, view?.running, chat.asking]);
  return (
    <aside class="window-chat" aria-label="Ask about your window">
      <header class="window-chat-head">
        <h2 class="window-chat-title">Ask about your window</h2>
        {view && (
          <Link route={{ page: "thread", id: view.id }} dispatch={dispatch} class="quiet-action">
            Open as a thread
          </Link>
        )}
        <button
          type="button"
          class="quiet-action"
          disabled={thread === null}
          onClick={() => send({ type: "newChatClicked" })}
        >
          New chat
        </button>
        <button
          type="button"
          class="window-chat-close"
          aria-label="Close the chat"
          onClick={() => send({ type: "closeClicked" })}
        >
          ×
        </button>
      </header>
      <ol class="chat window-chat-entries" ref={list}>
        {view && thread && (
          <ItemLinksContext.Provider value={{ dispatch, items: itemsOf(view) }}>
            {entriesOf(view.entries).map((entry) => (
              <ChatEntryItem
                key={entry.seq}
                entry={entry}
                model={thread}
                view={view}
                send={sendThread}
              />
            ))}
          </ItemLinksContext.Provider>
        )}
        {thread === null && !chat.asking && (
          <li class="window-chat-empty">
            Ask about what changed, what needs you, or what should become a workstream.
          </li>
        )}
        {(chat.asking || view?.running) && (
          <li class="working" role="status">
            <span class="working-dot" /> Working…
          </li>
        )}
      </ol>
      {chat.problem && (
        <p class="ask-problem" role="alert">
          {chat.problem}
        </p>
      )}
      {thread && view ? (
        <Composer
          draft={thread.draft}
          sending={thread.sending}
          running={view.running}
          notice={thread.notice}
          placeholder="Ask a follow-up"
          onDraft={(text) => sendThread({ type: "draftChanged", text })}
          onSend={() => sendThread({ type: "sendClicked" })}
          onStop={() => sendThread({ type: "stopClicked" })}
        />
      ) : (
        <Composer
          draft={chat.draft}
          sending={chat.asking}
          running={false}
          notice={null}
          placeholder="Ask about your window"
          onDraft={(text) => send({ type: "draftChanged", text })}
          onSend={() => send({ type: "askClicked" })}
        />
      )}
    </aside>
  );
}
