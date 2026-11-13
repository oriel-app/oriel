// A key shows as set, never the key itself.
import type { ComponentChildren } from "preact";
import type { ProviderKind, ProviderStatus, ProviderView } from "./view.ts";

const statusNames: Record<ProviderStatus, string> = {
  ready: "Ready",
  missing: "Not found",
  unsupported: "Needs an update",
  "signed-out": "Not signed in",
  untrusted: "Not run",
  checking: "Checking",
};

export const providerAbout: Record<ProviderKind, string> = {
  "claude-code": "For Claude Pro and Max · Anthropic's assistant for your Mac",
  codex: "For ChatGPT plans · OpenAI's assistant for your Mac",
  api: "Anthropic bills each question · from .env, for development",
};

const marks: Record<ProviderKind, string> = { "claude-code": "C", codex: "O", api: "A" };

export const codexPreview =
  "Less locked down than Claude Code: your own Codex settings still load, and Oriel can't check every tool Codex gives its model.";

export function ProviderRow(props: {
  provider: ProviderView;
  onToggle?(on: boolean): void;
  status?: ComponentChildren;
  side?: ComponentChildren;
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

export function Switch(props: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
    >
      <span class="switch-knob" aria-hidden="true" />
    </button>
  );
}
