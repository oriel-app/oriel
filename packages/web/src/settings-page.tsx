// Settings (OA-181): its sections down the left, each its own address, with
// room for more. Providers first: one row per provider instance, what Oriel
// found for it and a switch, then the default model and the Title model,
// picked from those connected and on, and how much of the plan Oriel has
// used. General: how a time is written, where a thread's page goes after
// an approval, and whether the desktop app asks before quitting while Oriel
// works. Appearance: the theme and the text
// size. Asking: which key sends a question. Every change applies at once.
import { useState } from "preact/hooks";
import { ClaudeCodeRow, CodexRow } from "./cli-row.tsx";
import { type Dispatch, Link, plural, useStamp } from "./parts.tsx";
import { ProviderRow, Switch } from "./provider-row.tsx";
import type { SettingsSection } from "./route.ts";
import type { SettingsModel, SettingsMsg } from "./settings.ts";
import type { SetupModel, SetupMsg } from "./setup.ts";
import type {
  AfterApprove,
  ModelPick,
  SendKey,
  SettingsChange,
  SettingsView,
  PlanWindowView,
  TextSize,
  TimeFormat,
  UsageView,
} from "./view.ts";

const sections: { id: SettingsSection; name: string }[] = [
  { id: "providers", name: "Providers" },
  { id: "general", name: "General" },
  { id: "appearance", name: "Appearance" },
  { id: "asking", name: "Asking" },
  { id: "notifications", name: "Notifications" },
];

export function SettingsPage(props: {
  model: SettingsModel;
  // On the desktop app, the Claude Code row the first run shares.
  setup: SetupModel;
  section: SettingsSection;
  dispatch: Dispatch;
}) {
  const { model, section, dispatch } = props;
  const send = (msg: SettingsMsg) => dispatch({ type: "settings", msg });
  const sendSetup = (msg: SetupMsg) => dispatch({ type: "setup", msg });
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
            <Providers
              model={model}
              view={view}
              send={send}
              change={change}
              setup={props.setup}
              sendSetup={sendSetup}
            />
          ) : section === "general" ? (
            <General view={view} change={change} />
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
  setup: SetupModel;
  sendSetup(msg: SetupMsg): void;
}) {
  const { model, view, send, change, setup } = props;
  const cli = setup.view?.cli ?? null;
  const codex = setup.view?.codex ?? null;
  const usage = (id: string) => model.usage?.find((u) => u.provider === id) ?? null;
  const path = (provider: SettingsView["providers"][number]) =>
    view.cliPaths && (
      <CliPath
        name={provider.name}
        program={provider.kind === "codex" ? "codex" : "claude"}
        saved={provider.path}
        typed={model.paths[provider.id]}
        onType={(text) => send({ type: "pathTyped", provider: provider.id, text })}
        onSave={() => send({ type: "pathSaved", provider: provider.id })}
      />
    );
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
          Oriel's agent runs on one of these. Your own Claude Code, or Codex as a preview, runs on
          your subscription, signed in however you signed it in; Oriel never sees how.
        </p>
        <ul class="provider-rows">
          {view.providers.map((provider) =>
            provider.kind === "claude-code" && cli ? (
              // The first run's own row, with what Oriel can do for it.
              <ClaudeCodeRow
                key={provider.id}
                provider={provider}
                cli={cli}
                model={setup}
                send={props.sendSetup}
                onToggle={(on) => change({ provider: provider.id, on })}
                onKey={() => document.getElementById("provider-api")?.scrollIntoView()}
              >
                {path(provider)}
              </ClaudeCodeRow>
            ) : provider.kind === "codex" && codex ? (
              <CodexRow
                key={provider.id}
                provider={provider}
                cli={codex}
                model={setup}
                send={props.sendSetup}
                onToggle={(on) => change({ provider: provider.id, on })}
                onKey={() => document.getElementById("provider-api")?.scrollIntoView()}
              >
                <PlanUsage usage={usage(provider.id)} name={provider.name} />
                {path(provider)}
              </CodexRow>
            ) : (
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
                {provider.kind !== "api" && (
                  <PlanUsage usage={usage(provider.id)} name={provider.name} />
                )}
                {provider.kind !== "api" && path(provider)}
              </ProviderRow>
            ),
          )}
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

const tokens = new Intl.NumberFormat(undefined, { notation: "compact" });

const windowNames: Record<PlanWindowView["kind"], string> = {
  session: "This session (5 hours)",
  week: "This week",
};

// How much of the person's plan Oriel has used (decision 0046): its own
// turns and tokens today, and the plan's windows as their Claude Code or
// Codex reports them, each with when it resets.
function PlanUsage({ usage, name }: { usage: UsageView | null; name: string }) {
  const stamp = useStamp();
  if (usage === null) return null;
  const { today, plan } = usage;
  return (
    <div class="plan-usage">
      <p class="plan-today">
        Oriel today: {plural(today.turns, "turn")} · {tokens.format(today.inputTokens)} tokens read,{" "}
        {tokens.format(today.outputTokens)} written
      </p>
      {"windows" in plan ? (
        <>
          <ul class="plan-windows" aria-label="Your plan">
            {plan.windows.map((window) => (
              <li key={window.kind} class="plan-window">
                <span class="plan-window-name">{windowNames[window.kind]}</span>
                <meter
                  class="plan-meter"
                  min={0}
                  max={100}
                  low={70}
                  high={90}
                  optimum={0}
                  value={window.usedPercent}
                  aria-label={`${windowNames[window.kind]}: ${window.usedPercent}% used`}
                />
                <span class="plan-window-used">
                  {window.usedPercent}% used
                  {window.resetsAt && ` · resets ${stamp(window.resetsAt, undefined, true)}`}
                </span>
              </li>
            ))}
          </ul>
          <p class="plan-note">Your whole plan, Oriel and everything else, as {name} says.</p>
        </>
      ) : plan.none === "no-answer" ? (
        <p class="plan-note">{name} didn't say how much of your plan is used. Check again.</p>
      ) : plan.none === "no-plan" ? (
        <p class="plan-note">This {name} isn't on a subscription plan, so it has no plan limits.</p>
      ) : null}
    </div>
  );
}

// Where a CLI is, when it isn't on the PATH Oriel was started with: the
// full path to the `claude` or `codex` program. Saving checks it at once.
function CliPath(props: {
  name: string;
  program: "claude" | "codex";
  saved: string | null;
  typed: string | undefined;
  onType(text: string): void;
  onSave(): void;
}) {
  const [open, setOpen] = useState(props.saved !== null);
  if (!open)
    return (
      <button type="button" class="quiet-action provider-path-open" onClick={() => setOpen(true)}>
        Use a {props.name} at another path
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
          placeholder={`/opt/homebrew/bin/${props.program}`}
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

const timeFormatNames: Record<TimeFormat, string> = {
  relative: "Relative, such as 3 min ago",
  absolute: "Date and time, such as Nov 3, 09:41",
};

const afterApproveNames: Record<AfterApprove, string> = {
  stay: "Stay on this thread",
  next: "Go to the next thing that needs you",
};

// How a time is written, where a thread's page goes once an approval there
// is accepted, and whether the desktop app asks before it quits while a
// thread's turn runs or a change set applies. Only the desktop app quits.
function General(props: { view: SettingsView; change(change: SettingsChange): void }) {
  const { view, change } = props;
  return (
    <section class="settings-section" aria-labelledby="settings-general">
      <h2 id="settings-general" class="settings-title">
        General
      </h2>
      <Choices
        name="Times"
        about="How Oriel writes when something happened, everywhere but a review link's page."
        options={Object.entries(timeFormatNames).map(([value, label]) => ({ value, label }))}
        value={view.timeFormat}
        onPick={(timeFormat) => change({ timeFormat: timeFormat as TimeFormat })}
      />
      <Choices
        name="After you approve"
        about="When you approve a change set in a thread. If nothing else needs you, you stay."
        options={Object.entries(afterApproveNames).map(([value, label]) => ({ value, label }))}
        value={view.afterApprove}
        onPick={(afterApprove) => change({ afterApprove: afterApprove as AfterApprove })}
      />
      {view.asksBeforeQuitting ? (
        <div class="settings-field settings-switch">
          <span class="settings-field-name">Ask before quitting while Oriel works</span>
          <span class="settings-field-about">
            While a thread's turn is running or a change set is applying, Quit (Cmd+Q) and closing
            Oriel's window ask first.
          </span>
          <Switch
            on={view.askBeforeQuitting}
            label="Ask before quitting while Oriel works"
            onChange={(askBeforeQuitting) => change({ askBeforeQuitting })}
          />
        </div>
      ) : (
        <p class="settings-field-about">Only the desktop app asks before quitting.</p>
      )}
    </section>
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
