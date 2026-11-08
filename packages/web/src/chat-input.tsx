// Where a person asks the agent (DRIFT D3): the thread's composer, the window
// chat's, the overview's ask bar and a workstream's Ask box, one frame for
// all of them. Its foot says what the agent will read, on the left. The send
// key is Settings' (Settings › Send says which); the box doesn't repeat it.
// Send is a plain button until there's something to send; only then is it
// the primary one.
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { SendKeyContext } from "./parts.tsx";
import { sendable, sends } from "./settings.ts";

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
