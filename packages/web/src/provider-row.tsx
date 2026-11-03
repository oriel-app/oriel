// One provider instance as a row: its name, what Oriel found (installed,
// signed in, its version, or a key set, never the key), the models it runs
// now, and a switch to turn it on or off. Settings lists these, and the
// first-run setup shows the same rows.
import type { ComponentChildren } from "preact";
import type { ProviderStatus, ProviderView } from "./view.ts";

// How each status reads at a glance, beside the row's own words.
const statusNames: Record<ProviderStatus, string> = {
  ready: "Ready",
  missing: "Not found",
  unsupported: "Needs an update",
  "signed-out": "Not signed in",
  "no-key": "No key",
  "not-yet": "Not supported yet",
  checking: "Checking",
};

export function ProviderRow(props: {
  provider: ProviderView;
  // Turns it on or off; absent where it can't be, as Codex's row.
  onToggle?(on: boolean): void;
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
    <li class="provider-row" data-status={provider.status} data-off={!provider.on || undefined}>
      <div class="provider-main">
        <span class="provider-name">{provider.name}</span>
        <span class="provider-status">
          <span class="provider-mark" aria-hidden="true" />
          <span class="provider-state">{statusNames[provider.status]}</span>
          <span class="provider-detail">{provider.detail}</span>
        </span>
        {uses && <span class="provider-uses">{uses}</span>}
        {props.children}
      </div>
      {onToggle && provider.kind !== "codex" && (
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
