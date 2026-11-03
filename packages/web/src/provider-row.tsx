// One provider instance as a row: its name, whose plans it's for and who
// makes it, what Oriel found (installed, signed in, its version, or a key
// set, never the key), the models it runs now, and a switch to turn it on or
// off. Settings lists these, and the first run shows the same rows, with
// what it can do for the person's Claude Code beneath (decision 0038).
// Codex's row is marked a preview, with what's less locked down than Claude
// Code (decision 0048).
import type { ComponentChildren } from "preact";
import type { ProviderKind, ProviderStatus, ProviderView } from "./view.ts";

// How each status reads at a glance, beside the row's own words.
const statusNames: Record<ProviderStatus, string> = {
  ready: "Ready",
  missing: "Not found",
  unsupported: "Needs an update",
  "signed-out": "Not signed in",
  "no-key": "No key",
  untrusted: "Not run",
  checking: "Checking",
};

// Whose plan each kind runs on, plans first, then who makes it.
export const providerAbout: Record<ProviderKind, string> = {
  "claude-code": "For Claude Pro and Max · Anthropic's assistant for your Mac",
  codex: "For ChatGPT plans · OpenAI's assistant for your Mac",
  api: "Anthropic bills each question",
};

const marks: Record<ProviderKind, string> = { "claude-code": "C", codex: "O", api: "A" };

// What a person gives up running on Codex, in one plain line.
export const codexPreview =
  "Less locked down than Claude Code: your own Codex settings still load, and Oriel can't check every tool Codex gives its model.";

export function ProviderRow(props: {
  provider: ProviderView;
  // Turns it on or off; absent where it can't be, as in the first run.
  onToggle?(on: boolean): void;
  // The row's own line of state, in place of its status and detail, as the
  // first run's Claude Code row has.
  status?: ComponentChildren;
  // What sits at the row's right: a pick, or the one action it offers.
  side?: ComponentChildren;
  // Picked, as the AI the first run continues with.
  picked?: boolean;
  children?: ComponentChildren;
}) {
  const { provider, onToggle } = props;
  const { model, title } = provider.uses;
  const uses =
    model && title
      ? model === title
        ? `Runs threads and titles on ${model}`
        : `Runs threads on ${model}, titles on ${title}`
      : model
        ? `Runs threads on ${model}`
        : title
          ? `Writes titles on ${title}`
          : provider.status === "ready" && provider.on
            ? "Not in use"
            : null;
  return (
    <li
      id={`provider-${provider.kind}`}
      class="provider-row"
      data-status={provider.status}
      data-off={!provider.on || undefined}
      data-picked={props.picked || undefined}
    >
      <span class="provider-icon" aria-hidden="true">
        {marks[provider.kind]}
      </span>
      <div class="provider-main">
        <span class="provider-name">
          {provider.name}
          {provider.kind === "codex" && <span class="provider-badge">Preview</span>}
        </span>
        <span class="provider-about">{providerAbout[provider.kind]}</span>
        {provider.kind === "codex" && <span class="provider-preview">{codexPreview}</span>}
        {props.status ?? (
          <span class="provider-status">
            <span class="provider-mark" aria-hidden="true" />
            <span class="provider-state">{statusNames[provider.status]}</span>
            <span class="provider-detail">{provider.detail}</span>
          </span>
        )}
        {onToggle && uses && <span class="provider-uses">{uses}</span>}
        {props.children}
      </div>
      {props.side && <div class="provider-side">{props.side}</div>}
      {onToggle && (
        <Switch on={provider.on} label={`Use ${provider.name}`} onChange={(on) => onToggle(on)} />
      )}
    </li>
  );
}

export function Switch(props: { on: boolean; label: string; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked={props.on}
      aria-label={props.label}
      onClick={() => props.onChange(!props.on)}
    >
      <span class="switch-knob" aria-hidden="true" />
    </button>
  );
}
