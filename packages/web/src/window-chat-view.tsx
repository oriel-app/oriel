import { useEffect, useRef, useState } from "preact/hooks";
import { ChatInput, type Composer, readsWith } from "./chat-input.tsx";
import { FoldedItem } from "./dock.tsx";
import { watchLatest } from "./effects.ts";
import { notLooking } from "./looking.ts";
import { NewMessage } from "./new-message.tsx";
import { type Dispatch, ItemLinksContext, Link } from "./parts.tsx";
import { entriesOf, expected, type ThreadModel, type ThreadMsg, unseen } from "./thread.ts";
import { ChatEntryItem, itemsOf } from "./thread-page.tsx";
import { PanelIcon } from "./sidebar.tsx";
import { Tooltip } from "./tooltip.tsx";
import {
  chatThread,
  movedOut,
  type Question,
  type WindowChatModel,
  type WindowChatMsg,
} from "./window-chat.ts";

export function OverviewComposer(props: {
  chat: WindowChatModel;
  thread: ThreadModel | null;
  ongoing: boolean;
  questions: Question[];
  noAi: boolean;
  dispatch: Dispatch;
}) {
  const { chat, ongoing, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  if (chat.open) return null;
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
  const drawn = windowChatComposer(chat, props.thread, dispatch);
  const composer = {
    ...drawn,
    onSubmit: () => {
      if (drawn.draft.trim() !== "") send({ type: "openClicked" });
      drawn.onSubmit();
    },
  };
  const starts = chat.lookingAt.chips.length === 0 ? props.questions : [];
  return (
    <div class="chat-dock overview-dock">
      <ChatInput
        {...composer}
        class="composer"
        elevation="raised"
        submitLabel="Ask"
        context={
          starts.length > 0 && (
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
          )
        }
        extra={
          ongoing && (
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
      {(props.about && question.short) || question.label}
    </button>
  );
}

const noneReadOnly = () => false;

export function WindowChat(props: {
  chat: WindowChatModel;
  thread: ThreadModel | null;
  questions: Question[];
  dispatch: Dispatch;
}) {
  const { chat, thread, dispatch } = props;
  const send = (msg: WindowChatMsg) => dispatch({ type: "chat", msg });
  const sendThread = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
  const view = thread && expected(thread);
  const moved = movedOut(thread);
  const list = useRef<HTMLOListElement>(null);
  const [tall, setTall] = useState(false);
  const grabbed = useRef<number | null>(null);
  useEffect(() => {
    const entries = list.current;
    if (!entries) return;
    entries.scrollTop = entries.scrollHeight;
    return watchLatest(sendThread, entries);
  }, [thread?.id]);
  const released = (y: number) => {
    const from = grabbed.current;
    grabbed.current = null;
    if (from === null) return;
    const dragged = y - from;
    if (dragged < -24) setTall(true);
    else if (dragged > 24 && tall) setTall(false);
    else if (dragged > 24) send({ type: "closeClicked" });
    else setTall(!tall);
  };
  return (
    <aside class="window-chat" aria-label="The window chat" data-tall={tall || undefined}>
      <button
        type="button"
        class="window-chat-grab"
        aria-label={tall ? "Make the chat shorter" : "Make the chat taller"}
        onPointerDown={(event) => {
          grabbed.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => released(event.clientY)}
        onPointerCancel={() => {
          grabbed.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setTall(!tall);
          }
        }}
      />
      <header class="window-chat-head">
        <h2 class="rail-title window-chat-title">Chat</h2>
        {view && (
          <Link
            route={{ page: "thread", id: view.id }}
            msg={{ type: "chat", msg: { type: "openAsThreadClicked" } }}
            dispatch={dispatch}
            class="quiet-action"
          >
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
        <Tooltip text="Hide the chat">
          <button
            type="button"
            class="sidebar-fold window-chat-fold"
            aria-label="Hide the chat"
            onClick={() => send({ type: "closeClicked" })}
          >
            <PanelIcon right />
          </button>
        </Tooltip>
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
        {moved && view && (
          <li class="window-chat-moved">
            Now a thread in{" "}
            <Link route={{ page: "thread", id: view.id }} dispatch={dispatch}>
              {view.workstream.name}
            </Link>
          </li>
        )}
        {thread === null && !chat.asking && props.questions.length > 0 && (
          <li class="rail-starts" role="group" aria-label="Questions to start from">
            {props.questions.map((question) => (
              <QuestionButton
                key={question.kind}
                question={question}
                chat={chat}
                dispatch={dispatch}
              />
            ))}
          </li>
        )}
        {thread === null && !chat.asking && props.questions.length === 0 && (
          <li class="window-chat-empty">
            Ask about what changed, what needs you, or what should become a workstream.
          </li>
        )}
        {(chat.asking || (!moved && view?.running)) && (
          <li class="working" role="status">
            <span class="working-dot" /> Working…
          </li>
        )}
      </ol>
      <FoldedItem />
      <ChatInput
        {...windowChatComposer(chat, thread, dispatch)}
        class="composer"
        elevation="raised"
        above={
          thread &&
          !moved &&
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

export function windowChatComposer(
  chat: WindowChatModel,
  thread: ThreadModel | null,
  dispatch: Dispatch,
): Composer {
  const live = chatThread(thread);
  const view = live && expected(live);
  if (live && view) {
    const thread = live;
    const sendThread = (msg: ThreadMsg) => dispatch({ type: "thread", msg });
    // A held message's words send as they were held, about nothing, so it offers nothing while they're there.
    const followUp = thread.composing ? notLooking : thread.lookingAt;
    return {
      label: "Message",
      draft: thread.draft,
      busy: thread.sending,
      running: view.running,
      notice: thread.notice ?? chat.problem,
      placeholder: "Ask a follow-up",
      reads: readsWith("Reads your whole window", followUp),
      looking: thread.composing
        ? undefined
        : {
            lookingAt: followUp,
            readOnly: noneReadOnly,
            onLooking: (msg) => sendThread({ type: "looking", msg }),
          },
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
    reads: readsWith("Reads your whole window", chat.lookingAt),
    looking: {
      lookingAt: chat.lookingAt,
      readOnly: noneReadOnly,
      onLooking: (msg) => send({ type: "looking", msg }),
    },
    onDraft: (text) => send({ type: "draftChanged", text }),
    onSubmit: () => send({ type: "askClicked" }),
  };
}
