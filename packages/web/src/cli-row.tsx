// The person's Claude Code as the first run and Settings show it, one row in
// both (decision 0038): what Oriel found, the one thing it can do next
// (Install, Sign in, Update), what it's doing while that runs, and, when it
// fails, one sentence, Try again, Show details with a log to copy, and other
// ways. Oriel never sees the sign-in: the browser does it with Claude Code.
// The person's Codex, a preview, has a row like it with only Sign in
// (decision 0048).
import type { ComponentChildren } from "preact";
import { useStamp } from "./parts.tsx";
import { ProviderRow } from "./provider-row.tsx";
import { trainingNotice } from "./training.ts";
import type { DetailsOf, SetupModel, SetupMsg } from "./setup.ts";
import type { CliView, ProviderView } from "./view.ts";

const phases = {
  downloading: "Downloading from Anthropic…",
  "setting-up": "Setting it up…",
  checking: "Checking it's genuine…",
  waiting: "Waiting for you in your browser…",
  updating: "Updating Claude Code…",
} as const;

// 41000 → "0:41".
export const elapsed = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

const plans = "https://claude.com/pricing";

// One line under a ready row signed in with a personal plan.
function TrainingLine(props: { kind: "claude-code" | "codex"; cli: CliView }) {
  const notice = trainingNotice(props.kind, props.cli);
  if (!notice) return null;
  return (
    <p class="cli-training">
      Your plan may let {notice.vendor} train on your chats.{" "}
      <a href={notice.page} target="_blank" rel="noreferrer">
        Check your setting
      </a>
    </p>
  );
}

export function ClaudeCodeRow(props: {
  provider: ProviderView;
  cli: CliView;
  model: SetupModel;
  send(msg: SetupMsg): void;
  // Picked as the AI the first run continues with.
  picked?: boolean;
  // Settings' switch.
  onToggle?(on: boolean): void;
  // Paying per question instead: the first run's key screen, or Settings'
  // key field.
  onKey(): void;
  // Claude Code's own way, in Terminal, written out.
  onOtherWays?(): void;
  children?: ComponentChildren;
}) {
  const { provider, cli, model, send } = props;
  const run = (command: "install" | "sign-in" | "update" | "check" | "cancel") =>
    send({ type: "commandClicked", command });
  const busy = model.sending;
  const button = (label: string, onClick: () => void, primary = false) => (
    <button
      type="button"
      class={primary ? "button primary" : "button"}
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const quiet = (label: string, onClick: () => void) => (
    <button type="button" class="link-action" disabled={busy} onClick={onClick}>
      {label}
    </button>
  );
  const keyInstead = quiet("Pay Anthropic per question instead", props.onKey);
  const { state, running, account } = cli;

  let status: ComponentChildren;
  let side: ComponentChildren = null;
  let below: ComponentChildren = null;
  switch (state) {
    case "checking":
      status = <Waiting>Looking for it on this Mac…</Waiting>;
      break;
    case "missing":
      status = <span class="cli-line">Not on this Mac yet.</span>;
      side = (
        <>
          <span class="cli-size">Free, about 310 MB</span>
          {button("Install", () => run("install"))}
        </>
      );
      break;
    case "installing":
    case "updating":
      status = running && (
        <Waiting>
          {phases[running.phase]} {elapsed(running.ms)}
        </Waiting>
      );
      side = quiet("Cancel", () => run("cancel"));
      below =
        state === "installing" ? (
          <div class="cli-progress">
            <span class="cli-bar" aria-hidden="true" />
            <span class="cli-note">
              Downloading → setting up → checking it's genuine. About 310 MB, usually a minute or
              two, straight from Anthropic.
            </span>
          </div>
        ) : null;
      break;
    case "unsupported":
      status = (
        <span class="cli-line">
          This Claude Code{cli.version && ` (${cli.version})`} is older than Oriel works with.
        </span>
      );
      if (cli.update?.by === "oriel") {
        side = button("Update", () => run("update"), true);
        below = (
          <span class="cli-note">
            Updates it from Anthropic, the way Claude Code updates itself. You stay signed in.
          </span>
        );
      } else if (cli.update?.by === "person") {
        side = button("Check again", () => run("check"));
        below = (
          <span class="cli-note">
            It was installed with your own tools, so Oriel leaves updating it to you: run{" "}
            <code>{cli.update.command}</code> in Terminal, then check again.
          </span>
        );
      }
      break;
    case "too-new":
      status = (
        <span class="cli-line">
          This Claude Code{cli.version && ` (${cli.version})`} is newer than Oriel works with yet.
        </span>
      );
      below = (
        <div class="cli-box">
          <p>Oriel's next update will work with it. Until then:</p>
          <div class="cli-actions">{button("Pay Anthropic per question instead", props.onKey)}</div>
        </div>
      );
      break;
    case "signed-out":
      status = (
        <span class="cli-line">
          <strong>Installed.</strong> Now sign in with your Claude account.
        </span>
      );
      side = button("Sign in", () => run("sign-in"), true);
      below = (
        <span class="cli-note">
          Your browser opens claude.ai. Oriel never sees your password or your chats.
        </span>
      );
      break;
    case "signing-in":
      status = <Waiting>Waiting for you in your browser…</Waiting>;
      side = quiet("Cancel", () => run("cancel"));
      below = (
        <div class="cli-box">
          <p>
            <strong>A tab opened on claude.ai.</strong> It asks you to let Claude Code use your
            Claude account: click <strong>Authorize</strong>. Oriel comes back to the front by
            itself when you're done.
          </p>
          <p class="cli-small">
            No tab, or the wrong account? {quiet("Start again", () => run("sign-in"))}
          </p>
        </div>
      );
      break;
    case "no-plan":
      status = (
        <span class="cli-line">
          Signed in{account?.email ? ` as ${account.email}` : ""}
          {account?.plan ? ` · ${account.plan}` : ""}
        </span>
      );
      below = (
        <div class="cli-box" data-tone="warn">
          <p>
            <strong>This account's plan doesn't include Claude Code.</strong> Claude Pro or Max
            does.
          </p>
          <div class="cli-actions">
            <a class="button" href={plans} target="_blank" rel="noreferrer">
              See Claude plans
            </a>
            {button("Use another account", () => run("sign-in"))}
          </div>
          <p class="cli-small">
            {keyInstead}. In the tab that opens, check the account at the top. If it's still the old
            one, sign out of claude.ai there first.
          </p>
        </div>
      );
      break;
    case "untrusted":
      // The check's own sentence: what Oriel found wrong with the file.
      status = <span class="cli-line">{provider.detail}</span>;
      side = button("Install again", () => run("install"));
      break;
    case "ready":
      status = (
        <span class="provider-status">
          <span class="provider-mark" aria-hidden="true" />
          <span class="provider-state">Ready</span>
          <span>
            {[account?.plan, account?.email].filter(Boolean).map((part) => `· ${part} `)}·{" "}
            {quiet("Not this account?", () => send({ type: "anotherClicked", open: true }))}
          </span>
        </span>
      );
      if (props.picked !== undefined)
        side = (
          <span
            class="cli-picked"
            role="img"
            aria-label="Picked"
            data-on={props.picked || undefined}
          />
        );
      if (model.another)
        below = (
          <div class="cli-box">
            <p>
              <strong>Sign Claude Code in with another account?</strong> Claude Code then uses that
              account everywhere on this Mac, not only in Oriel.
            </p>
            <div class="cli-actions">
              {button("Sign in with another account", () => run("sign-in"), true)}
              {button("Keep this one", () => send({ type: "anotherClicked", open: false }))}
            </div>
            <p class="cli-small">
              In the tab that opens, check the account at the top. If it's still the old one, sign
              out of claude.ai there first.
            </p>
          </div>
        );
      break;
  }

  // A failure's own box carries the way on, in place of the row's action.
  if (cli.failed && !running && cli.failed.why !== "no-plan" && cli.failed.what !== "test")
    side = null;
  return (
    <ProviderRow
      provider={provider}
      status={status}
      side={side}
      {...(props.picked !== undefined ? { picked: props.picked } : {})}
      {...(props.onToggle ? { onToggle: props.onToggle } : {})}
    >
      <TrainingLine kind="claude-code" cli={cli} />
      {below}
      {cli.failed && !running && (
        <Failed
          failed={cli.failed}
          model={model}
          send={send}
          onKey={props.onKey}
          {...(props.onOtherWays ? { onOtherWays: props.onOtherWays } : {})}
        />
      )}
      {props.children}
    </ProviderRow>
  );
}

// The person's Codex, a preview (decision 0048): what Oriel found, Sign in
// through Codex's own `codex login`, what it's doing while that runs, and,
// when it fails, the same box as Claude Code's. Oriel doesn't install or
// update Codex: an old one names the person's own command.
export function CodexRow(props: {
  provider: ProviderView;
  cli: CliView;
  model: SetupModel;
  send(msg: SetupMsg): void;
  picked?: boolean;
  onToggle?(on: boolean): void;
  onKey(): void;
  children?: ComponentChildren;
}) {
  const { provider, cli, model, send } = props;
  const run = (command: "sign-in" | "check" | "cancel") =>
    send({ type: "commandClicked", command, cli: "codex" });
  const button = (label: string, onClick: () => void, primary = false) => (
    <button
      type="button"
      class={primary ? "button primary" : "button"}
      disabled={model.sending}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const quiet = (label: string, onClick: () => void) => (
    <button type="button" class="link-action" disabled={model.sending} onClick={onClick}>
      {label}
    </button>
  );
  const { state, account, running } = cli;
  let status: ComponentChildren = null;
  let side: ComponentChildren = null;
  let below: ComponentChildren = null;
  switch (state) {
    case "checking":
      status = <Waiting>Looking for it on this Mac…</Waiting>;
      break;
    case "signed-out":
      status = (
        <span class="cli-line">
          <strong>Installed.</strong> Now sign in with your ChatGPT account.
        </span>
      );
      side = button("Sign in", () => run("sign-in"), true);
      below = (
        <span class="cli-note">
          Your browser opens OpenAI's sign-in. Oriel never sees your password or your chats.
        </span>
      );
      break;
    case "signing-in":
      status = <Waiting>Waiting for you in your browser… {running && elapsed(running.ms)}</Waiting>;
      side = quiet("Cancel", () => run("cancel"));
      below = (
        <div class="cli-box">
          <p>
            <strong>A tab opened on OpenAI's sign-in.</strong> Sign in with your ChatGPT account.
            Oriel comes back to the front by itself when you're done.
          </p>
          <p class="cli-small">
            No tab, or the wrong account? {quiet("Start again", () => run("sign-in"))}
          </p>
        </div>
      );
      break;
    case "unsupported":
      status = (
        <span class="cli-line">
          This Codex{cli.version && ` (${cli.version})`} is older than Oriel works with.
        </span>
      );
      side = button("Check again", () => run("check"));
      below = (
        <span class="cli-note">
          {cli.update?.by === "person" ? (
            <>
              Update it with the tool you installed it with: run <code>{cli.update.command}</code>{" "}
              in Terminal, then check again.
            </>
          ) : (
            "Update it the way you installed it, then check again."
          )}
        </span>
      );
      break;
    case "too-new":
      status = (
        <span class="cli-line">
          This Codex{cli.version && ` (${cli.version})`} is newer than Oriel works with yet. Oriel's
          next update will work with it.
        </span>
      );
      break;
    case "ready":
      status = (
        <span class="provider-status">
          <span class="provider-mark" aria-hidden="true" />
          <span class="provider-state">Ready</span>
          {[account?.plan, account?.email].filter(Boolean).map((part) => (
            <span key={part}>· {part}</span>
          ))}
        </span>
      );
      if (props.picked !== undefined)
        side = (
          <span
            class="cli-picked"
            role="img"
            aria-label="Picked"
            data-on={props.picked || undefined}
          />
        );
      break;
    default:
      status = <span class="cli-line">{provider.detail}</span>;
  }
  if (cli.failed && !running && cli.failed.what !== "test") side = null;
  return (
    <ProviderRow
      provider={provider}
      status={status}
      side={side}
      {...(props.picked !== undefined ? { picked: props.picked } : {})}
      {...(props.onToggle ? { onToggle: props.onToggle } : {})}
    >
      <TrainingLine kind="codex" cli={cli} />
      {below}
      {cli.failed && !running && (
        <Failed failed={cli.failed} model={model} send={send} onKey={props.onKey} codex />
      )}
      {props.children}
    </ProviderRow>
  );
}

function Waiting(props: { children: ComponentChildren }) {
  return (
    <span class="cli-line cli-waiting" role="status">
      <span class="spinner" aria-hidden="true" />
      {props.children}
    </span>
  );
}

// What went wrong, in one sentence, never more than Oriel knows, with the
// way on: Try again, Show details, other ways. `codex`: Codex's row's.
function Failed(props: {
  failed: NonNullable<CliView["failed"]>;
  model: SetupModel;
  send(msg: SetupMsg): void;
  onKey(): void;
  onOtherWays?(): void;
  codex?: true;
}) {
  const { failed, model, send } = props;
  const which = props.codex ? ({ cli: "codex" } as const) : {};
  const ai = props.codex ? ({ ai: "codex" } as const) : {};
  const again = (command: "install" | "sign-in" | "update") =>
    send({ type: "commandClicked", command, ...which });
  const busy = model.sending;
  const retry =
    failed.what === "test"
      ? failed.why === "usage-limit"
        ? {
            label: "Continue anyway",
            onClick: () => send({ type: "continueClicked", anyway: true, ...ai }),
          }
        : failed.why === "no-plan"
          ? null
          : { label: "Try again", onClick: () => send({ type: "continueClicked", ...ai }) }
      : failed.what === "sign-in"
        ? { label: "Start again", onClick: () => again("sign-in") }
        : { label: "Try again", onClick: () => again(failed.what as "install" | "update") };
  if (failed.why === "no-plan") return null;
  const resets = resetsAt(failed.resets, useStamp());
  const what: DetailsOf = failed.what;
  return (
    <div class="cli-box" data-tone={failed.why === "usage-limit" ? "warn" : "danger"} role="alert">
      <p>
        <strong>{failed.sentence}</strong>
        {resets && ` It resets ${resets}.`}
      </p>
      <div class="cli-actions">
        {retry && (
          <button type="button" class="button primary" disabled={busy} onClick={retry.onClick}>
            {retry.label}
          </button>
        )}
        {failed.why !== "usage-limit" && (
          <button
            type="button"
            class="button"
            aria-expanded={model.details}
            onClick={() => send({ type: "detailsToggled" })}
          >
            {model.details ? "Hide details" : "Show details"}
          </button>
        )}
        {model.details && (
          <button
            type="button"
            class="button"
            onClick={() => send({ type: "detailsCopied", text: failed.log.join("\n"), what })}
          >
            Copy details
          </button>
        )}
        {props.onOtherWays && (failed.what === "install" || failed.what === "sign-in") && (
          <button type="button" class="link-action" onClick={props.onOtherWays}>
            {failed.what === "install" ? "Other ways to install" : "Other ways to sign in"}
          </button>
        )}
        {failed.what === "test" && (
          <button type="button" class="link-action" onClick={props.onKey}>
            Pay Anthropic per question instead
          </button>
        )}
      </div>
      {model.details && (
        <>
          <pre class="cli-log">{failed.log.join("\n")}</pre>
          <p class="cli-small">
            These hold no password or key. Send them to whoever helps you with your Mac.
          </p>
        </>
      )}
    </div>
  );
}

// When a usage limit resets, in the time format: an instant from the CLI,
// or its own words.
function resetsAt(resets: string | null, stamp: ReturnType<typeof useStamp>): string | null {
  if (resets === null) return null;
  if (Number.isNaN(Date.parse(resets))) return resets;
  return stamp(resets, clockAt, true);
}

const clockAt = (instant: string) =>
  `at ${new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
