// The window chat on screen (decisions 0027 and 0030): the overview's
// composer at the page's foot, and the chat beside
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
import type { Question, WindowChatModel, WindowChatMsg } from "./window-chat.ts";

// The overview's composer (decision 0030): a thread's, raised in a thread's
// dock at the page's foot. Asking opens the window chat; while it's open,
// the chat's own composer is the one to type in, so this one is hidden, as
// a thread's is under the item panel's dock. The questions to start from
// sit beside their headlines (`QuestionButton`); one with no headline on
// screen, such as the empty window's plan, sits in its frame, unless an
// item is in view: what the message is about comes first (decision 0062).
export function OverviewComposer(props: {
  chat: WindowChatModel;
  // Whether there is a conversation to go back to, behind a closed chat.
  ongoing: boolean;
  // The questions no headline on screen holds.
  questions: Question[];
  // No AI is set up, so it says so and opens Settings (decision 0038).
  noAi: boolean;
  dispatch: Dispatch;
}) {
  const { chat, ongoing, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  if (props.noAi)
    return (
      <div class="chat-dock overview-dock">
        <div class="chat-input composer" data-elevation="raised" data-off>
          <textarea
            rows={2}
            class="chat-input-field"
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
      </div>
    );
  const composer = windowChatComposer(chat, null, dispatch);
  const starts = chat.lookingAt.chips.length === 0 ? props.questions : [];
  return (
    <div class="chat-dock overview-dock" inert={chat.open || undefined}>
      <ChatInput
        {...composer}
        class="composer"
        elevation="raised"
        submitLabel="Ask"
        notice={chat.open ? null : composer.notice}
        context={
          <>
            {starts.length > 0 && (
              <div class="ask-starts" role="group" aria-label="Questions to start from">
                {starts.map((question) => (
                  <QuestionButton
                    key={question.kind}
                    question={question}
                    chat={chat}
                    dispatch={dispatch}
                  />
                ))}
              </div>
            )}
            {composer.context}
          </>
        }
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
      />
    </div>
  );
}

// A question to start from, as a button: its label shows, and its fixed
// wording is what's sent. `about`: the ID of the headline line it comes from,
// which describes it.
export function QuestionButton(props: {
  question: Question;
  chat: WindowChatModel;
  about?: string;
  dispatch: Dispatch;
}) {
  const { question } = props;
  return (
    <button
      type="button"
      class="ask-question"
      disabled={props.chat.asking}
      aria-describedby={props.about}
      onClick={() => props.dispatch({ type: "chat", msg: { type: "questionPicked", question } })}
    >
      {question.label}
    </button>
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

// The window chat's composer, as the overview's foot, the chat and the item
// panel's dock (dock.tsx) draw it: a follow-up in its thread, or its first
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
    onSubmit: () => send({ type: "askClicked" }),
  };
}
