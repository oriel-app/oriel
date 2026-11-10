// Where a person asks the agent (DRIFT D3): the thread's composer, the window
// chat's, the overview's ask bar and a workstream's Ask box, one frame for
// all of them. Its foot says what the agent will read, on the left. The send
// key is Settings' (Settings › Send says which); the box doesn't repeat it.
// Send is a plain button until there's something to send; only then is it
// the primary one.
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { LookItem, LookingAt, LookingMsg } from "./looking.ts";
import { SendKeyContext } from "./parts.tsx";
import { sendable, sends } from "./settings.ts";
import { Tooltip } from "./tooltip.tsx";

export function ChatInput(props: {
  draft: string;
  placeholder: string;
  // The field's accessible name, each place's own ("Message", "Ask about
  // this workstream").
  label: string;
  // One line, as the ask bar is, where Enter always asks (decision 0041);
  // or a field that grows, which sends on Settings' key.
  lines?: "one" | "grow";
  size?: "md" | "lg";
  submitLabel?: "Send" | "Ask";
  // A send on its way: the button waits.
  busy: boolean;
  // The agent is answering, so Stop takes the button's place.
  running?: boolean;
  onStop?(): void;
  // The one problem line, inside the frame.
  notice?: string | null;
  // Raised where it floats over a thread; flat elsewhere.
  elevation?: "raised" | "flat";
  // The theme's ask mark, which only the ask bar wears.
  marked?: boolean;
  // What the agent will read, such as "Reads 17 items · v3".
  reads?: string | null;
  // Beside the button, such as Back to the chat.
  extra?: ComponentChildren;
  // What floats over it, such as the pill for a change set out of view.
  above?: ComponentChildren;
  // What the next message is about, over the field (`LookingChips`).
  context?: ComponentChildren;
  class?: string;
  onDraft(text: string): void;
  onSubmit(): void;
}) {
  const sendKey = useContext(SendKeyContext);
  const one = props.lines === "one";
  const live = sendable(props.draft, props.busy);
  const field = {
    class: one ? "chat-input-field ask-input" : "chat-input-field",
    value: props.draft,
    placeholder: props.placeholder,
    "aria-label": props.label,
    onInput: (event: { currentTarget: { value: string } }) =>
      props.onDraft(event.currentTarget.value),
  };
  return (
    <form
      class={props.class ? `chat-input ${props.class}` : "chat-input"}
      data-lines={one ? "one" : "grow"}
      data-size={props.size === "lg" ? "lg" : undefined}
      data-elevation={props.elevation === "raised" ? "raised" : undefined}
      data-marked={props.marked || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {props.above}
      {props.context}
      {one ? (
        <input type="text" {...field} />
      ) : (
        <textarea
          rows={2}
          {...field}
          onKeyDown={(event) => {
            if (sends(event, sendKey)) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
        />
      )}
      <div class="chat-input-foot">
        {props.reads && <span class="chat-input-reads">{props.reads}</span>}
        {props.extra}
        {props.running && props.onStop ? (
          <button type="button" class="button" onClick={props.onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" class={live ? "button primary" : "button"} disabled={!live}>
            {props.submitLabel ?? "Send"}
          </button>
        )}
      </div>
      {props.notice && (
        <p class="chat-input-notice" role="alert">
          {props.notice}
        </p>
      )}
    </form>
  );
}

// What the next message is about, over the composer's field (decision
// 0062): the item open beside it, "Looking at", with × to leave it out;
// left out, dashed, "Not sending", with Add back; and the item opened since
// beside a draft that keeps its own, dashed, which + adds. One outside the
// thread's region says read-only, with Cite beside it, which adds it to the
// workstream as the panel's Add does: looking alone never does.
export function LookingChips(props: {
  lookingAt: LookingAt;
  readOnly(id: string): boolean;
  onLooking(msg: LookingMsg): void;
  onCite?(item: LookItem): void;
}) {
  const { chips, offered } = props.lookingAt;
  if (chips.length === 0 && offered === null) return null;
  const named = (item: LookItem) => (
    <span class="ctx-name">
      <b>{item.key}</b>
      {item.title && ` ${item.title}`}
    </span>
  );
  return (
    <div class="ctx" role="group" aria-label="What your message is about">
      {chips.map(({ item, on }, i) =>
        on ? (
          <span class="ctx-chip" key={item.id}>
            {i === 0 && <span class="ctx-label">Looking at</span>}
            {named(item)}
            {props.readOnly(item.id) && <span class="ctx-label">· read-only</span>}
            <Tooltip text="Don't send">
              <button
                type="button"
                class="ctx-x"
                aria-label={`Leave ${item.key} out`}
                onClick={() => props.onLooking({ type: "lookDropped", id: item.id })}
              >
                ×
              </button>
            </Tooltip>
          </span>
        ) : (
          <span class="ctx-chip" data-off key={item.id}>
            <span class="ctx-label">Not sending</span>
            {named(item)}
          </span>
        ),
      )}
      {chips.map(({ item, on }) =>
        !on ? (
          <button
            type="button"
            class="quiet-action ctx-action"
            key={`back-${item.id}`}
            onClick={() => props.onLooking({ type: "lookAddedBack", id: item.id })}
          >
            Add back
          </button>
        ) : props.onCite && props.readOnly(item.id) ? (
          <button
            type="button"
            class="quiet-action ctx-action"
            key={`cite-${item.id}`}
            onClick={() => props.onCite?.(item)}
          >
            Cite
          </button>
        ) : null,
      )}
      {offered && (
        <button
          type="button"
          class="ctx-chip"
          data-off
          aria-label={`Add ${offered.key} to what your message is about`}
          onClick={() => props.onLooking({ type: "lookOfferedAdded" })}
        >
          <span class="ctx-label">+</span>
          {named(offered)}
        </button>
      )}
    </div>
  );
}

// The foot's line with what the message is about: "Reads your whole
// window, and SYN-99", saying which are read-only.
export function readsWith(
  reads: string | null,
  lookingAt: LookingAt,
  readOnly: (id: string) => boolean,
): string | null {
  const on = lookingAt.chips.filter((chip) => chip.on).map((chip) => chip.item);
  if (on.length === 0) return reads;
  const named = on
    .map((item) => (readOnly(item.id) ? `${item.key} (read-only)` : item.key))
    .join(", ");
  return reads ? `${reads}, and ${named}` : `Reads ${named}`;
}
