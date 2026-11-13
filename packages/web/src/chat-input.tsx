// The send key is Settings' to say (Settings › Send); the box doesn't repeat it.
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { useMoveDrop } from "./drag-move.ts";
import { type LookItem, type LookingAt, type LookingMsg, placeable } from "./looking.ts";
import { SendKeyContext } from "./parts.tsx";
import { sendable, sends } from "./settings.ts";
import { Tooltip } from "./tooltip.tsx";

export function ChatInput(props: {
  draft: string;
  placeholder: string;
  label: string;
  submitLabel?: "Send" | "Ask";
  busy: boolean;
  running?: boolean;
  onStop?(): void;
  notice?: string | null;
  elevation?: "raised" | "flat";
  reads?: string | null;
  extra?: ComponentChildren;
  above?: ComponentChildren;
  looking?: Looking;
  context?: ComponentChildren;
  class?: string;
  onDraft(text: string): void;
  onSubmit(): void;
}) {
  const sendKey = useContext(SendKeyContext);
  const live = sendable(props.draft, props.busy);
  const { looking } = props;
  const drop = useMoveDrop(
    (item) =>
      item.kind === "item" && looking !== undefined && placeable(looking.lookingAt, item.id),
    (item) => {
      if (item.kind !== "item" || !looking) return;
      const { id, key, title } = item;
      looking.onLooking({ type: "lookPlaced", item: { id, key, title, under: null } });
    },
  );
  return (
    <form
      class={props.class ? `chat-input ${props.class}` : "chat-input"}
      data-elevation={props.elevation === "raised" ? "raised" : undefined}
      data-drop-over={drop.over || undefined}
      {...drop.props}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {props.above}
      {props.context}
      {looking && <LookingChips {...looking} />}
      <textarea
        rows={2}
        class="chat-input-field"
        value={props.draft}
        placeholder={props.placeholder}
        aria-label={props.label}
        onInput={(event) => props.onDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (sends(event, sendKey)) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
      />
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

export type Composer = Parameters<typeof ChatInput>[0];

export type Looking = {
  lookingAt: LookingAt;
  readOnly(id: string): boolean;
  onLooking(msg: LookingMsg): void;
};

function LookingChips(props: Looking) {
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

export function readsWith(reads: string | null, lookingAt: LookingAt): string | null {
  const on = lookingAt.chips.filter((chip) => chip.on).map((chip) => chip.item);
  if (on.length === 0) return reads;
  const named = on.map((item) => item.key).join(", ");
  return reads ? `${reads}, and ${named}` : `Reads ${named}`;
}
