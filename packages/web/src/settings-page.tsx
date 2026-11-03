// Settings (OA-181): its sections down the left, each its own address, with
// room for more. Providers first: one row per provider instance, what Oriel
// found for it and a switch, then the default model and the Title model,
// picked from those connected and on. Appearance: the theme and the text
// size. Asking: which key sends a question. Every change applies at once.
import { useState } from "preact/hooks";
import { type Dispatch, Link } from "./parts.tsx";
import { ProviderRow, Switch } from "./provider-row.tsx";
import type { SettingsSection } from "./route.ts";
import type { SettingsModel, SettingsMsg } from "./settings.ts";
import type { ModelPick, SendKey, SettingsChange, SettingsView, TextSize } from "./view.ts";

const sections: { id: SettingsSection; name: string }[] = [
  { id: "providers", name: "Providers" },
  { id: "appearance", name: "Appearance" },
  { id: "asking", name: "Asking" },
  { id: "notifications", name: "Notifications" },
];

export function SettingsPage(props: {
  model: SettingsModel;
  section: SettingsSection;
  dispatch: Dispatch;
}) {
  const { model, section, dispatch } = props;
  const send = (msg: SettingsMsg) => dispatch({ type: "settings", msg });
  const change = (change: SettingsChange) => send({ type: "changed", change });
  const { view } = model;
  return (
    <main class="page settings-page">
      <h1 class="page-title">Settings</h1>
      <div class="settings">
        <nav class="settings-sections" aria-label="Settings">
          {sections.map((each) => (
            <Link
              key={each.id}
              route={{ page: "settings", section: each.id }}
              dispatch={dispatch}
              class="nav-link"
              aria-current={each.id === section ? "page" : undefined}
            >
              {each.name}
            </Link>
          ))}
        </nav>
        <div class="settings-body">
          {model.problem && (
            <p class="settings-problem" role="alert">
              {model.problem}
            </p>
          )}
          {view === null ? (
            <p class="loading">Loading…</p>
          ) : section === "providers" ? (
            <Providers model={model} view={view} send={send} change={change} />
          ) : section === "appearance" ? (
            <Appearance view={view} change={change} />
          ) : section === "asking" ? (
            <Asking view={view} change={change} />
          ) : (
            <Notifications view={view} change={change} />
          )}
        </div>
      </div>
    </main>
  );
}

function Providers(props: {
  model: SettingsModel;
  view: SettingsView;
  send(msg: SettingsMsg): void;
  change(change: SettingsChange): void;
}) {
  const { model, view, send, change } = props;
  if (view.scripted)
    return (
      <section class="settings-section" aria-labelledby="settings-providers">
        <h2 id="settings-providers" class="settings-title">
          Providers
        </h2>
        <p class="settings-lede">
          Oriel is running its scripted agent, as <code>--agent scripted</code> asked, so it uses no
          provider. Start it without that to pick one here.
        </p>
      </section>
    );
  return (
    <>
      <section class="settings-section" aria-labelledby="settings-providers">
        <div class="settings-head">
          <h2 id="settings-providers" class="settings-title">
            Providers
          </h2>
          <button
            type="button"
            class="button"
            disabled={model.looking}
            onClick={() => send({ type: "lookClicked" })}
          >
            {model.looking ? "Checking…" : "Check again"}
          </button>
        </div>
        <p class="settings-lede">
          Oriel's agent runs on one of these. Your own Claude Code runs on your subscription, signed
          in however you signed it in; Oriel never sees how.
        </p>
        <ul class="provider-rows">
          {view.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onToggle={(on) => change({ provider: provider.id, on })}
            >
              {provider.kind === "api" && view.apiKeys && (
                <ApiKey
                  set={provider.status === "ready"}
                  typed={model.key}
                  keying={model.keying}
                  onType={(text) => send({ type: "keyTyped", text })}
                  onSave={() => send({ type: "keySaved" })}
                  onRemove={() => send({ type: "keyRemoved" })}
                />
              )}
              {provider.kind === "claude-code" && view.cliPaths && (
                <CliPath
                  name={provider.name}
                  saved={provider.path}
                  typed={model.paths[provider.id]}
                  onType={(text) => send({ type: "pathTyped", provider: provider.id, text })}
                  onSave={() => send({ type: "pathSaved", provider: provider.id })}
                />
              )}
            </ProviderRow>
          ))}
        </ul>
      </section>
      <section class="settings-section" aria-labelledby="settings-models">
        <h2 id="settings-models" class="settings-title">
          Models
        </h2>
        <ModelPicker
          label="Default model"
          about="Runs every thread's turns."
          view={view}
          value={view.model}
          onPick={(model) => change({ model })}
        />
        <ModelPicker
          label="Title model"
          about="Writes each thread's title from its first message."
          view={view}
          value={view.titleModel}
          onPick={(titleModel) => change({ titleModel })}
        />
      </section>
    </>
  );
}

// Where Claude Code is, when it isn't on the PATH Oriel was started with:
// the full path to the `claude` program. Saving checks it at once.
function CliPath(props: {
  name: string;
  saved: string | null;
  typed: string | undefined;
  onType(text: string): void;
  onSave(): void;
}) {
  const [open, setOpen] = useState(props.saved !== null);
  if (!open)
    return (
      <button type="button" class="quiet-action provider-path-open" onClick={() => setOpen(true)}>
        Use a Claude Code at another path
      </button>
    );
  const value = props.typed ?? props.saved ?? "";
  return (
    <form
      class="provider-path"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label class="provider-path-label">
        <span>Path to {props.name}</span>
        <input
          type="text"
          class="input"
          value={value}
          placeholder="/opt/homebrew/bin/claude"
          spellcheck={false}
          autoComplete="off"
          onInput={(event) => props.onType(event.currentTarget.value)}
        />
      </label>
      <button type="submit" class="button" disabled={props.typed === undefined}>
        Save
      </button>
    </form>
  );
}

// An API key from Anthropic's console, on the desktop app: paying per
// question instead of a plan. Saving checks it with Anthropic, then keeps it
// in the OS secret store. The field never shows a key that's kept.
function ApiKey(props: {
  set: boolean;
  typed: string;
  keying: boolean;
  onType(text: string): void;
  onSave(): void;
  onRemove(): void;
}) {
  const [open, setOpen] = useState(false);
  if (props.set && !open)
    return (
      <span class="provider-key-actions">
        <button type="button" class="quiet-action" onClick={() => setOpen(true)}>
          Use another key
        </button>
        <button
          type="button"
          class="quiet-action"
          disabled={props.keying}
          onClick={() => props.onRemove()}
        >
          {props.keying ? "Removing…" : "Remove the key"}
        </button>
      </span>
    );
  return (
    <form
      class="provider-path"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
        setOpen(false);
      }}
    >
      <label class="provider-path-label">
        <span>API key</span>
        <input
          type="password"
          class="input"
          value={props.typed}
          placeholder="sk-ant-…"
          spellcheck={false}
          autoComplete="off"
          onInput={(event) => props.onType(event.currentTarget.value)}
        />
      </label>
      <button type="submit" class="button" disabled={props.keying || props.typed.trim() === ""}>
        {props.keying ? "Checking…" : "Save"}
      </button>
      {props.set && (
        <button type="button" class="quiet-action" onClick={() => setOpen(false)}>
          Cancel
        </button>
      )}
      <span class="provider-key-note">
        Make one on{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          Anthropic's console
        </a>
        . Anthropic bills each question, and you can set a monthly limit there. Oriel keeps the key
        in your system's secret store.
      </span>
    </form>
  );
}

function ModelPicker(props: {
  label: string;
  about: string;
  view: SettingsView;
  value: ModelPick | null;
  onPick(pick: ModelPick): void;
}) {
  const { view, value } = props;
  const key = (pick: ModelPick) => `${pick.provider} ${pick.model}`;
  const options = view.models;
  return (
    <label class="settings-field">
      <span class="settings-field-name">{props.label}</span>
      <span class="settings-field-about">
        {options.length === 0 ? "Turn on a provider that's ready to pick one." : props.about}
      </span>
      <select
        class="select"
        disabled={options.length === 0}
        value={value ? key(value) : ""}
        onChange={(event) => {
          const picked = options.find((option) => key(option) === event.currentTarget.value);
          if (picked) props.onPick({ provider: picked.provider, model: picked.model });
        }}
      >
        {value === null && <option value="">None</option>}
        {options.map((option) => (
          <option key={key(option)} value={key(option)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const themeName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const textSizeNames: Record<TextSize, string> = {
  small: "Small",
  default: "Default",
  large: "Large",
};

function Appearance(props: { view: SettingsView; change(change: SettingsChange): void }) {
  const { view, change } = props;
  return (
    <section class="settings-section" aria-labelledby="settings-appearance">
      <h2 id="settings-appearance" class="settings-title">
        Appearance
      </h2>
      <Choices
        name="Theme"
        about="How Oriel looks, light or dark as your system is. It changes nothing Oriel shows."
        options={view.themes.map((theme, i) => ({
          value: theme,
          label: i === 0 ? `${themeName(theme)} (the default)` : themeName(theme),
        }))}
        value={view.theme}
        onPick={(theme) => change({ theme })}
      />
      <Choices
        name="Text size"
        about="The size of everything in the window."
        options={Object.entries(textSizeNames).map(([value, label]) => ({ value, label }))}
        value={view.textSize}
        onPick={(textSize) => change({ textSize: textSize as TextSize })}
      />
    </section>
  );
}

const sendNames: Record<SendKey, string> = {
  enter: "Enter sends. Shift+Enter starts a new line.",
  "mod-enter": "Cmd+Enter (Ctrl+Enter) sends. Enter starts a new line.",
};

function Asking(props: { view: SettingsView; change(change: SettingsChange): void }) {
  const { view, change } = props;
  return (
    <section class="settings-section" aria-labelledby="settings-asking">
      <h2 id="settings-asking" class="settings-title">
        Asking
      </h2>
      <Choices
        name="Sending a question"
        about="In a thread, the window chat and a workstream's page."
        options={Object.entries(sendNames).map(([value, label]) => ({ value, label }))}
        value={view.send}
        onPick={(send) => change({ send: send as SendKey })}
      />
    </section>
  );
}

// One switch: a desktop notification when a thread newly needs you, while
// Oriel's window isn't in front. Only the desktop app shows them.
function Notifications(props: { view: SettingsView; change(change: SettingsChange): void }) {
  const { view, change } = props;
  return (
    <section class="settings-section" aria-labelledby="settings-notifications">
      <h2 id="settings-notifications" class="settings-title">
        Notifications
      </h2>
      {view.notifies ? (
        <div class="settings-field settings-switch">
          <span class="settings-field-name">Notify me when a thread needs me</span>
          <span class="settings-field-about">
            A change set to review, an answer waiting on you, or a held message, while Oriel's
            window isn't in front. Clicking one opens its thread.
          </span>
          <Switch
            on={view.notify}
            label="Notify me when a thread needs me"
            onChange={(notify) => change({ notify })}
          />
        </div>
      ) : (
        <p class="settings-lede">Only the desktop app shows notifications.</p>
      )}
    </section>
  );
}

// A setting picked from a few, as radio buttons.
function Choices(props: {
  name: string;
  about: string;
  options: { value: string; label: string }[];
  value: string;
  onPick(value: string): void;
}) {
  const group = `settings-${props.name.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <fieldset class="settings-field">
      <legend class="settings-field-name">{props.name}</legend>
      <span class="settings-field-about">{props.about}</span>
      <div class="choices">
        {props.options.map((option) => (
          <label key={option.value} class="choice">
            <input
              type="radio"
              name={group}
              value={option.value}
              checked={option.value === props.value}
              onChange={() => props.onPick(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
