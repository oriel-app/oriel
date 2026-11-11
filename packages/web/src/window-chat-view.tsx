// The window chat on screen (decisions 0027 and 0030): the ask bar under the
// overview's counts strip, with questions to start from, and the chat beside
// the overview while it has a conversation, over the page's right side, or
// as a sheet on a narrow window. While an item is open, on a window with
// room, the chat moves into the page column beside it, and "‹ Window" puts
// the overview back; narrower, the item covers it and carries the chat's
// composer in its dock (dock.tsx). Its composer offers the item open as
// what the next question is about (decision 0062). Its entries render as a
// thread's page renders them, blocks included; its fields are the one
// ChatInput.
import { useEffect, useRef } from "preact/hooks";
import { ChatInput, type Composer, LookingChips, readsWith } from "./chat-input.tsx";
import { FoldedItem } from "./dock.tsx";
import { watchLatest } from "./effects.ts";
import { notLooking } from "./looking.ts";
import { NewMessage } from "./new-message.tsx";
import { type Dispatch, ItemLinksContext, Link } from "./parts.tsx";
import { entriesOf, expected, type ThreadModel, type ThreadMsg, unseen } from "./thread.ts";
import { ChatEntryItem, itemsOf } from "./thread-page.tsx";
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
  // A stand-in is on, which a plan may be drafted into (decision
  // 0059).
  plans?: boolean;
  dispatch: Dispatch;
}) {
  const { chat, view, ongoing, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  if (props.noAi)
    return (
      <section class="ask" aria-label="Ask about your window">
        <div class="chat-input" data-lines="one" data-size="lg" data-marked data-off>
          <input
            type="text"
            class="chat-input-field ask-input"
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
  const questions = view ? questionsFrom(view, props.firstRun === true, props.plans === true) : [];
  return (
    <section class="ask" aria-label="Ask about your window">
      <ChatInput
        lines="one"
        size="lg"
        marked
        label="Ask about your window"
        placeholder="Ask about your window"
        submitLabel="Ask"
        draft={chat.draft}
        busy={chat.asking}
        reads="Reads your whole window"
        notice={chat.open ? null : chat.problem}
        extra={
          ongoing &&
          !chat.open && (
            <button
              type="button"
              class="quiet-action"
              onClick={() => send({ type: "openClicked" })}
            >
              Back to the chat
            </button>
          )
        }
        onDraft={(text) => send({ type: "draftChanged", text })}
        onSubmit={() => send({ type: "askClicked" })}
      />
      {questions.length > 0 && (
        <>
          <h2 class="ask-starts-head" id="ask-starts-head">
            Questions to start from
          </h2>
          <ul class="ask-questions" aria-labelledby="ask-starts-head">
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
        </>
      )}
    </section>
  );
}

// The window chat reads every item as the window does: none is read-only
// there, as no region holds it.
const noneReadOnly = () => false;

export function WindowChat(props: {
  chat: WindowChatModel;
  thread: ThreadModel | null;
  // An item is open beside it, so it stands in the page column for the
  // overview.
  beside: boolean;
  dispatch: Dispatch;
}) {
  const { chat, thread, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  const sendThread = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
  const view = thread && expected(thread);
  const list = useRef<HTMLOListElement>(null);
  // The chat opens at its latest entry, and follows what arrives only while
  // it's there, as a thread's page does (`watchLatest`, `keptAtLatest`).
  useEffect(() => {
    const entries = list.current;
    if (!entries) return;
    entries.scrollTop = entries.scrollHeight;
    return watchLatest(sendThread, entries);
  }, [thread?.id]);
  return (
    <aside class="window-chat" aria-label="Ask about your window">
      <header class="window-chat-head">
        {props.beside && (
          <button
            type="button"
            class="quiet-action window-chat-back"
            onClick={() => send({ type: "closeClicked" })}
          >
            ‹ Window
          </button>
        )}
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
        {/* Beside an item, "‹ Window" closes it instead. */}
        {!props.beside && (
          <button
            type="button"
            class="window-chat-close"
            aria-label="Close the chat"
            onClick={() => send({ type: "closeClicked" })}
          >
            ×
          </button>
        )}
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
      <FoldedItem />
      <ChatInput
        {...windowChatComposer(chat, thread, dispatch)}
        class="composer"
        above={
          thread &&
          unseen(thread) && (
            <div class="composer-pills">
              <NewMessage onShow={() => sendThread({ type: "latestClicked" })} />
            </div>
          )
        }
      />
    </aside>
  );
}

// The window chat's composer, as the chat and the item panel's dock
// (dock.tsx) both draw it: a follow-up in its thread, or its first
// question. One problem line, the thread's or the chat's own.
export function windowChatComposer(
  chat: WindowChatModel,
  thread: ThreadModel | null,
  dispatch: Dispatch,
): Composer {
  const view = thread && expected(thread);
  if (thread && view) {
    const sendThread = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
    // A held message's words in the composer send as they were held, about
    // nothing, so it offers nothing while they're there (decision 0062).
    const followUp = thread.composing ? notLooking : thread.lookingAt;
    return {
      label: "Message",
      draft: thread.draft,
      busy: thread.sending,
      running: view.running,
      notice: thread.notice ?? chat.problem,
      placeholder: "Ask a follow-up",
      reads: readsWith("Reads your whole window", followUp, noneReadOnly),
      context: (
        <LookingChips
          lookingAt={followUp}
          readOnly={noneReadOnly}
          onLooking={(msg) => sendThread({ type: "looking", msg })}
        />
      ),
      onDraft: (text) => sendThread({ type: "draftChanged", text }),
      onSubmit: () => sendThread({ type: "sendClicked" }),
      onStop: () => sendThread({ type: "stopClicked" }),
    };
  }
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  return {
    label: "Message",
    draft: chat.draft,
    busy: chat.asking,
    notice: chat.problem,
    placeholder: "Ask about your window",
    reads: readsWith("Reads your whole window", chat.lookingAt, noneReadOnly),
    context: (
      <LookingChips
        lookingAt={chat.lookingAt}
        readOnly={noneReadOnly}
        onLooking={(msg) => send({ type: "looking", msg })}
      />
    ),
    onDraft: (text) => send({ type: "draftChanged", text }),
    onSubmit: () => send({ type: "askClicked", chat: true }),
  };
}
