---
title: Connection and provider rows
status: drifting
group: Rows
order: 52
classes: provider-rows, provider-row, provider-icon, provider-main, provider-name, provider-badge, provider-about, provider-preview, provider-status, provider-mark, provider-state, provider-uses, provider-side, connection-row, connection-options, connection-said, connection-problem, connection-report, cli-line, cli-waiting, spinner, cli-size, cli-note, cli-small, cli-box, cli-actions, cli-log, cli-picked, cli-progress, cli-bar, cli-training, provider-path-open, provider-key-actions, provider-key-note, switch, switch-knob, settings, settings-sections, settings-body, settings-section, settings-head, settings-title, settings-lede, settings-problem, settings-field, settings-switch, settings-field-name, settings-field-about, input, choices, choice
summary: One thing Oriel uses or reads, as a row with its mark, name, what it is, its state and the one thing to do next. Settings' providers and connections and the first run draw it; four hand copies today.
---

# Connection and provider rows

## What it is

A row for one thing Oriel runs on or reads: a provider (Claude Code, Codex, an API key) or a connection (Jira, a folder, Google Sheets). Every Settings row and every first-run row has the same shape:

- a **mark** (`.provider-icon`): the thing's letter in a 2.25rem tile;
- a **main column** (`.provider-main`): its name, a line saying what it is, its **status line**, and anything it lets the person set or do, stacked;
- a **side** (`.provider-side`): the one action it offers (Sync, Connect, Install, Sign in), or the first run's pick mark;
- on a provider in Settings, a **switch** at the far right that turns it on or off.

The component is `ProviderRow` in `packages/web/src/provider-row.tsx`: "One provider instance as a row: its name, whose plans it's for and who makes it, what Oriel found …, the models it runs now, and a switch to turn it on or off." Connections, Add a connection and the first run's sources write the same markup again by hand, which is the drift below.

The rows sit in one framed list, `.provider-rows`, which takes the theme's list tokens (`--list-frame`, `--list-bg`): framed on the surface in Graphite, open on the page in Broadsheet.

## When to use it

- For anything Oriel connects to, runs on or reads from, in Settings and the first run: one row each, drawn the same way whatever its kind.
- When the thing has a state the person needs at a glance (Ready, Synced 3 min ago, Not signed in) and at most one next step.
- When it has settings of its own: they go in the row's main column, under its status line, as Connections' options do.

## When not to

- Not for items, threads or workstreams. Those are [list rows](/components/list-row).
- Not in the sidebar. A source there is a `.nav-link` row with its count and Sync on hover; see [Sidebar](/components/sidebar). It reads the same connection, but it's a way into Browse, not a place to set it up.
- Not for picking one of several in a connect step. That's `.choice-rows` (see [Connect steps](/patterns/connect-steps)), which shares the frame but not the row.
- Not as a card for a message or a warning. A row's warning or failure is a `.cli-box` inside its main column, never a row of its own.

## Anatomy and variants

The row is a flex line, top-aligned, `--space-4` apart, padded `--space-3` `--space-4`, with a `--line` rule between rows (`.provider-row` and `.provider-row + .provider-row` in `window.css`). The main column is a grid with `--space-1` between its lines.

### Providers (Settings › Providers)

```html specimen id=providers title="Providers: ready, a preview not in use, and a key not set"
<ul class="provider-rows">
  <li id="provider-claude-code" class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Ready</span>
        <span>Signed in · version 2.1.314</span>
      </span>
      <span class="provider-uses">Runs threads on Opus 5.5, titles on Haiku 5.5</span>
    </div>
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked="true"
      aria-label="Use Claude Code"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
  <li id="provider-codex" class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">O</span>
    <div class="provider-main">
      <span class="provider-name">Codex<span class="provider-badge">Preview</span></span>
      <span class="provider-about">For ChatGPT plans · OpenAI's assistant for your Mac</span>
      <span class="provider-preview"
        >Less locked down than Claude Code: your own Codex settings still load, and Oriel can't
        check every tool Codex gives its model.</span
      >
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Ready</span>
        <span>Signed in · version 0.166.0</span>
      </span>
      <span class="provider-uses">Not in use</span>
    </div>
    <button type="button" role="switch" class="switch" aria-checked="true" aria-label="Use Codex">
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
  <li id="provider-api" class="provider-row" data-status="no-key">
    <span class="provider-icon" aria-hidden="true">A</span>
    <div class="provider-main">
      <span class="provider-name">API key</span>
      <span class="provider-about">Anthropic bills each question</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">No key</span>
        <span>No key is set. Paste one from Anthropic's console to pay per question.</span>
      </span>
    </div>
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked="false"
      aria-label="Use API key"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
</ul>
```

The status line's third part is `<span class="provider-detail">` in the app (`ProviderRow` in `packages/web/src/provider-row.tsx`). window.css has no rule for that class, so the specimens leave it off; it looks the same.

### A path and a key, in Settings

Under a CLI's row in Settings › Providers, **Use a Claude Code at another path** (`.provider-path-open`, a quiet action pulled left to line up with the words) opens a path field, for a CLI that isn't on the PATH Oriel started with. Under the API key's row, once a key is set, **Use another key** and **Remove the key** sit side by side (`.provider-key-actions`); typing a key shows a note under the field (`.provider-key-note`, `--text-sm` in `--text-muted`, a whole line of its own) on where to make one and how it's billed and kept.

```html specimen id=path-and-key title="Another path, a key that's set, and a key being typed" width=390
<div class="settings">
  <div class="settings-body">
    <ul class="provider-rows">
      <li class="provider-row" data-status="ready">
        <span class="provider-icon" aria-hidden="true">C</span>
        <div class="provider-main">
          <span class="provider-name">Claude Code</span>
          <span class="provider-about"
            >For Claude Pro and Max · Anthropic's assistant for your Mac</span
          >
          <span class="provider-status"
            ><span class="provider-mark" aria-hidden="true"></span
            ><span class="provider-state">Ready</span><span>Signed in · version 2.1.314</span></span
          >
          <button type="button" class="quiet-action provider-path-open">
            Use a Claude Code at another path
          </button>
        </div>
      </li>
      <li id="provider-api" class="provider-row" data-status="ready">
        <span class="provider-icon" aria-hidden="true">A</span>
        <div class="provider-main">
          <span class="provider-name">API key</span>
          <span class="provider-about">Anthropic bills each question</span>
          <span class="provider-status"
            ><span class="provider-mark" aria-hidden="true"></span
            ><span class="provider-state">Ready</span
            ><span>A key is kept in the OS secret store</span></span
          >
          <span class="provider-key-actions"
            ><button type="button" class="quiet-action">Use another key</button
            ><button type="button" class="quiet-action">Remove the key</button></span
          >
        </div>
      </li>
      <li class="provider-row" data-status="no-key">
        <span class="provider-icon" aria-hidden="true">A</span>
        <div class="provider-main">
          <span class="provider-name">API key</span>
          <span class="provider-about">Anthropic bills each question</span>
          <form class="provider-path">
            <label class="provider-path-label"
              ><span>API key</span
              ><input
                type="password"
                class="input"
                placeholder="sk-ant-…"
                spellcheck="false"
                autocomplete="off"
            /></label>
            <button type="submit" class="button" disabled>Save</button>
            <span class="provider-key-note"
              >Make one on
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
                >Anthropic's console</a
              >. Anthropic bills each question, and you can set a monthly limit there. Oriel keeps
              the key in your system's secret store.</span
            >
          </form>
        </div>
      </li>
    </ul>
  </div>
</div>
```

The path and key fields themselves are on [Text field](/components/text-field#settings-path). Removing says "Removing…" while it runs; saving a key says "Checking…" while Anthropic checks it.

### Picked through a source server

A connection through a source server (decision 0059) has no options of its own but what the person picks through the server: Jira's project, Linear's team, Slack's channels. Each is the same picker Settings re-picks a connection's project with (`PickOption` in `packages/web/src/connections-page.tsx`), drawn by `ServerPicks`: what it reads now and **Change**, or, with nothing picked yet, what it reads instead ("Reading your first 20 channels; pick yours.") and **Pick**. Its list comes through the server's read tools. One option is a radio list that applies on a click; several are ticks, up to the most the source reads, applied with **Use these N**. A long list scrolls under Find (`.connection-options .choices` in `window.css`). The first run draws the same under what Oriel found, each named by its source ("Jira project"), in `.found-picks`.

```html specimen id=server-picks title="Slack's channels, picked through its server"
<div class="connection-options">
  <fieldset class="settings-field">
    <legend class="settings-field-name">Channels</legend>
    <span class="settings-field-about">Reading your first 20 channels; pick yours. </span>
    <div class="choices">
      <label class="choice"><input type="checkbox" value="C1" checked />#weather-disruptions</label>
      <label class="choice"><input type="checkbox" value="C2" />#random</label>
      <div class="cli-actions">
        <button type="button" class="button primary">Use these 1</button>
        <button type="button" class="button">Cancel</button>
      </div>
      <span class="settings-field-about">At most 20.</span>
    </div>
  </fieldset>
</div>
```

### The status line

`.provider-status` is a dot, a state word and a detail, in `--text-sm`. **Its colour comes from the row, not the line**: the dot and word are `--danger` unless the row says otherwise (`.provider-mark` and `.provider-state` in `window.css`).

```html specimen id=status-tones title="Status line tones, by the row's data-status"
<ul class="provider-rows">
  <li class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">data-status="ready": green</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span><span>Signed in · version 2.1.314</span></span
      >
    </div>
  </li>
  <li class="provider-row" data-status="checking">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">data-status="checking", or data-off: faint</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Checking</span></span
      >
    </div>
  </li>
  <li class="provider-row" data-status="signed-out">
    <span class="provider-icon" aria-hidden="true">O</span>
    <div class="provider-main">
      <span class="provider-name">Anything else: danger</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Not signed in</span></span
      >
    </div>
  </li>
</ul>
```

The state words come from `statusNames` in `packages/web/src/provider-row.tsx`: Ready, Not found, Needs an update, Not signed in, No key, Not run, Checking.

### Claude Code and Codex rows (`cli-row.tsx`)

The person's own Claude Code and Codex are a `ProviderRow` with their own status line, side action and what goes under (`ClaudeCodeRow` in `packages/web/src/cli-row.tsx`). The status becomes a `.cli-line`; a running step is a `.cli-line.cli-waiting` with a `.spinner`; a note under it is a `.cli-note`; a question or a failure is a `.cli-box`.

```html specimen id=cli-states title="Claude Code: looking, missing, installing, signed out"
<ul class="provider-rows">
  <li class="provider-row" data-status="checking">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line cli-waiting" role="status"
        ><span class="spinner" aria-hidden="true"></span>Looking for it on this Mac…</span
      >
    </div>
  </li>
  <li class="provider-row" data-status="missing">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line">Not on this Mac yet.</span>
    </div>
    <div class="provider-side">
      <span class="cli-size">Free, about 310 MB</span>
      <button type="button" class="button">Install</button>
    </div>
  </li>
  <li class="provider-row" data-status="missing">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line cli-waiting" role="status"
        ><span class="spinner" aria-hidden="true"></span>Downloading from Anthropic… 0:41</span
      >
      <div class="cli-progress">
        <span class="cli-bar" aria-hidden="true"></span>
        <span class="cli-note"
          >Downloading → setting up → checking it's genuine. About 310 MB, usually a minute or two,
          straight from Anthropic.</span
        >
      </div>
    </div>
    <div class="provider-side">
      <button type="button" class="link-action">Cancel</button>
    </div>
  </li>
  <li class="provider-row" data-status="signed-out">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line"
        ><strong>Installed.</strong> Now sign in with your Claude account.</span
      >
      <span class="cli-note"
        >Your browser opens claude.ai. Oriel never sees your password or your chats.</span
      >
    </div>
    <div class="provider-side">
      <button type="button" class="button primary">Sign in</button>
    </div>
  </li>
</ul>
```

```html specimen id=cli-failed title="A failure: one sentence and the way on, in place of the side action"
<ul class="provider-rows">
  <li class="provider-row" data-status="missing">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line">Not on this Mac yet.</span>
      <div class="cli-box" data-tone="danger" role="alert">
        <p>
          <strong
            >Claude Code didn't finish installing. The download from Anthropic stopped partway. A
            work network can block it; if trying again doesn't help, send the details to your IT
            team.</strong
          >
        </p>
        <div class="cli-actions">
          <button type="button" class="button primary">Try again</button>
          <button type="button" class="button" aria-expanded="true">Hide details</button>
          <button type="button" class="button">Copy details</button>
          <button type="button" class="link-action">Other ways to install</button>
        </div>
        <pre class="cli-log">
curl: (56) Recv failure: Connection reset by peer
Downloaded 112 MB of 310 MB</pre>
        <p class="cli-small">
          These hold no password or key. Send them to whoever helps you with your Mac.
        </p>
      </div>
    </div>
  </li>
</ul>
```

```html specimen id=cli-picked title="The first run: picked, as the AI it continues with"
<ul class="provider-rows">
  <li id="provider-claude-code" class="provider-row" data-status="ready" data-picked>
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span
        ><span
          >· Pro · amara.okafor@example.com ·
          <button type="button" class="link-action">Not this account?</button></span
        ></span
      >
    </div>
    <div class="provider-side">
      <span class="cli-picked" role="img" aria-label="Picked" data-on></span>
    </div>
  </li>
  <li id="provider-codex" class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">O</span>
    <div class="provider-main">
      <span class="provider-name">Codex<span class="provider-badge">Preview</span></span>
      <span class="provider-about">For ChatGPT plans · OpenAI's assistant for your Mac</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span><span>· Plus</span></span
      >
    </div>
    <div class="provider-side">
      <span class="cli-picked" role="img" aria-label="Not picked"></span>
    </div>
  </li>
</ul>
```

The app gives the unpicked mark the same `aria-label="Picked"` as the picked one (`ClaudeCodeRow` in `packages/web/src/cli-row.tsx`), so a screen reader hears "Picked" on both. The specimen says "Not picked"; see Drift.

A ready row signed in with a personal plan says one more line under its status: the plan may let its vendor train on the person's chats, with a link to the setting (`.cli-training`). Oriel can't read that setting, so the line says "may" and never says training is off. There's none for a Team, Business, Enterprise or Edu plan, or an API key (`trainingNotice` in `packages/web/src/training.ts`).

```html specimen id=cli-training title="Ready on a personal plan: the training line"
<ul class="provider-rows">
  <li id="provider-claude-code" class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span
        ><span>· Pro · amara.okafor@example.com</span></span
      >
      <p class="cli-training">
        Your plan may let Anthropic train on your chats.
        <a href="https://claude.ai/settings/data-privacy-controls" target="_blank" rel="noreferrer"
          >Check your setting</a
        >
      </p>
    </div>
  </li>
</ul>
```

`.cli-training` shares `.cli-note`'s look: `--text-sm` in `--text-faint`, at `--leading-prose`.

### Connections (Settings › Connections), in the Settings frame

A connection row adds what a person sets on it under its status line: its name, its connector's options, whether Oriel may propose changes, and how often it syncs. Each applies at once; the last change says itself beside the option it changed, with Undo. Sync is the side action; Disconnect is a quiet action at the foot of the main column, and asks first.

This specimen is also the Settings frame a screen draws: `main.page` with its `.page-title`, then `.settings` (a 10rem column of sections beside the body), `.settings-sections` (the sidebar's [nav links](/components/sidebar)), and `.settings-body` holding `.settings-section`s.

```html specimen id=connections title="Settings › Connections: a connection, set and synced"
<main class="page">
  <h1 class="page-title">Settings</h1>
  <div class="settings">
    <nav class="settings-sections" aria-label="Settings">
      <a class="nav-link" href="/settings/providers">Providers</a>
      <a class="nav-link" href="/settings/connections" aria-current="page">Connections</a>
      <a class="nav-link" href="/settings/general">General</a>
      <a class="nav-link" href="/settings/appearance">Appearance</a>
      <a class="nav-link" href="/settings/asking">Asking</a>
      <a class="nav-link" href="/settings/notifications">Notifications</a>
    </nav>
    <div class="settings-body">
      <section class="settings-section" aria-labelledby="settings-connections">
        <h2 id="settings-connections" class="settings-title">Connections</h2>
        <p class="settings-lede">
          Everything Oriel reads, one row each. A change applies at once, and the next sync reads
          with it.
        </p>
        <ul class="provider-rows">
          <li class="provider-row connection-row" id="connection-jira" data-status="ready">
            <span class="provider-icon" aria-hidden="true">J</span>
            <div class="provider-main">
              <span class="provider-name">Ferrowick Jira</span>
              <span class="provider-about">Jira · SYN on oriel.atlassian.net</span>
              <span class="provider-status">
                <span class="provider-mark" aria-hidden="true"></span>
                <span class="provider-state">Synced just now</span>
                <span>· 120 items</span>
              </span>
              <div class="connection-options">
                <label class="settings-field">
                  <span class="settings-field-name">Name</span>
                  <span class="settings-field-about">How the window names it.</span>
                  <input class="input" value="Ferrowick Jira" placeholder="Jira" maxlength="60" />
                </label>
                <div class="connection-said" role="status">
                  <span
                    >Set its name. <button type="button" class="quiet-action">Undo</button></span
                  >
                </div>
                <fieldset class="settings-field">
                  <legend class="settings-field-name">Project</legend>
                  <span class="settings-field-about"
                    >SYN <button type="button" class="quiet-action">Change</button></span
                  >
                </fieldset>
                <div class="settings-field settings-switch">
                  <span class="settings-field-name">Oriel may propose changes</span>
                  <span class="settings-field-about"
                    >Off, Oriel only reads Jira, and the agent can't propose a change to it. On,
                    nothing changes there until you approve it.</span
                  >
                  <button
                    type="button"
                    role="switch"
                    class="switch"
                    aria-checked="true"
                    aria-label="Oriel may propose changes to Ferrowick Jira"
                  >
                    <span class="switch-knob" aria-hidden="true"></span>
                  </button>
                </div>
                <fieldset class="settings-field">
                  <legend class="settings-field-name">How often it syncs</legend>
                  <span class="settings-field-about"
                    >While Oriel is open. Sync in the sidebar reads it any time.</span
                  >
                  <div class="choices">
                    <label class="choice"
                      ><input type="radio" name="connection-jira-every" value="start" checked />When
                      Oriel starts, and when you ask</label
                    >
                    <label class="choice"
                      ><input type="radio" name="connection-jira-every" value="5" />Every 5
                      minutes</label
                    >
                    <label class="choice"
                      ><input type="radio" name="connection-jira-every" value="15" />Every 15
                      minutes</label
                    >
                    <label class="choice"
                      ><input type="radio" name="connection-jira-every" value="60" />Every
                      hour</label
                    >
                  </div>
                </fieldset>
              </div>
              <span class="cli-actions">
                <button type="button" class="quiet-action">Disconnect Ferrowick Jira</button>
              </span>
            </div>
            <div class="provider-side">
              <button type="button" class="button">Sync</button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</main>
```

The app's list is `ul.provider-rows.connection-rows` and the page is `main.page.settings-page` (`Connections` in `packages/web/src/connections-page.tsx`, `SettingsPage` in `packages/web/src/settings-page.tsx`). Neither `connection-rows` nor `settings-page` has a rule in window.css, so the specimens leave them off.

```html specimen id=connection-states title="Connection states: signed out, what a sync left out, syncing after a problem, a problem"
<ul class="provider-rows">
  <li class="provider-row connection-row" id="connection-jira-out">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">SYN on oriel.atlassian.net</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Signed out</span>
      </span>
      <p class="settings-field-about">
        Jira turned Oriel away when it started. Connect it again below, or disconnect it.
      </p>
      <span class="cli-actions">
        <button type="button" class="quiet-action">Disconnect Jira</button>
      </span>
    </div>
    <div class="provider-side"></div>
  </li>
  <li class="provider-row connection-row" id="connection-sheets" data-status="ready">
    <span class="provider-icon" aria-hidden="true">S</span>
    <div class="provider-main">
      <span class="provider-name">Google Sheets</span>
      <span class="provider-about">Checkout v2 tracker</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Synced 3 min ago</span>
        <span>· 48 items</span>
      </span>
      <ul class="connection-report" aria-label="What its last sync didn't read">
        <li>
          Checkout v2 tracker, Stories: rows 14 and 22 share a Row ID, so none of them is an item
          yet.
        </li>
        <li>Checkout v2 tracker, Stories: 3 hidden rows not read.</li>
      </ul>
    </div>
    <div class="provider-side"><button type="button" class="button">Sync</button></div>
  </li>
  <li class="provider-row connection-row" id="connection-folder">
    <span class="provider-icon" aria-hidden="true">F</span>
    <div class="provider-main">
      <span class="provider-name">Folder</span>
      <span class="provider-about">~/Documents/Launch notes</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Syncing…</span>
        <span>· 3 items</span>
      </span>
    </div>
    <div class="provider-side"><button type="button" class="button" disabled>Sync</button></div>
  </li>
  <li class="provider-row connection-row" id="connection-folder-problem">
    <span class="provider-icon" aria-hidden="true">F</span>
    <div class="provider-main">
      <span class="provider-name">Folder</span>
      <span class="provider-about">~/Documents/Launch notes</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">A problem</span>
        <span>· 3 items</span>
      </span>
      <p class="connection-problem" role="alert">
        Folder couldn't be read that way. Nothing changed.
      </p>
    </div>
    <div class="provider-side"><button type="button" class="button">Sync</button></div>
  </li>
</ul>
```

The third row is the drift below: a connection with a standing problem syncs again, and its "Syncing…" is drawn in `--danger`, while the same word on a connection without one is green. The problem line hides while it syncs (`ConnectionRow` in `packages/web/src/connections-page.tsx`).

```html specimen id=disconnect title="Disconnect asks first, in the row"
<ul class="provider-rows">
  <li class="provider-row connection-row" id="connection-jira-ask" data-status="ready">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">SYN on oriel.atlassian.net</span>
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Synced 3 min ago</span>
        <span>· 120 items</span>
      </span>
      <div class="cli-box" data-tone="warn" role="alertdialog" aria-label="Disconnect Jira?">
        <p>
          <strong>Disconnect Jira?</strong> Its 120 items leave the window, with what Oriel keeps to
          sign in to it. Workstreams keep them as items Oriel no longer has, and threads keep what
          was said. Nothing changes in Jira.
        </p>
        <div class="cli-actions">
          <button type="button" class="button danger">Disconnect</button>
          <button type="button" class="button">Cancel</button>
        </div>
      </div>
    </div>
    <div class="provider-side"><button type="button" class="button">Sync</button></div>
  </li>
</ul>
```

### Through a source server (decision 0059)

Jira on through Atlassian's MCP server in the person's agent (OA-276) has a row like any connection's, with Sync, but no options and no Disconnect: what it reads is the server's, and the person turns it off under [Source servers](/components/source-servers). One line says so.

```html specimen id=through title="Jira through Atlassian's server: Sync, and no Disconnect"
<ul class="provider-rows">
  <li class="provider-row connection-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about"
        >SYN on oriel.atlassian.net, through Atlassian's Rovo MCP server</span
      >
      <span class="provider-status">
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Synced 3 min ago</span>
        <span>· 120 items</span>
      </span>
      <p class="settings-field-about">
        Oriel reads it through atlassian, a server in your agent. Turn it off under Source servers.
      </p>
    </div>
    <div class="provider-side"><button type="button" class="button">Sync</button></div>
  </li>
</ul>
```

### Add a connection

Every connector, one row each: its name and what it reads, then either Connect at the side or a line saying why it can't connect now. Picking one draws its [connect steps](/patterns/connect-steps) in the row's main column. These rows set no `data-status`, so they have no status line.

```html specimen id=add-connection title="Add a connection"
<section class="settings-section" aria-labelledby="settings-add-connection">
  <h2 id="settings-add-connection" class="settings-title">Add a connection</h2>
  <ul class="provider-rows">
    <li class="provider-row">
      <span class="provider-icon" aria-hidden="true">J</span>
      <div class="provider-main">
        <span class="provider-name">Jira</span>
        <span class="provider-about">Epics, stories and their details</span>
        <span class="settings-field-about">Jira is already connected to this window.</span>
      </div>
    </li>
    <li class="provider-row">
      <span class="provider-icon" aria-hidden="true">F</span>
      <div class="provider-main">
        <span class="provider-name">Folder</span>
        <span class="provider-about"
          >Notes saved as files on this Mac, and its folders. Oriel only reads them.</span
        >
      </div>
      <div class="provider-side"><button type="button" class="button">Connect</button></div>
    </li>
    <li class="provider-row">
      <span class="provider-icon" aria-hidden="true">S</span>
      <div class="provider-main">
        <span class="provider-name">Slack</span>
        <span class="settings-field-about">Slack can't be connected from this window.</span>
      </div>
    </li>
  </ul>
</section>
```

### The first run's source rows

The first run's Your work and Reading your work steps draw each source with `SourceRow` in `packages/web/src/setup-page.tsx`, a local copy of the same shell. Its green line is set on the line itself, with `data-connected`, because it doesn't own the row (`connected` in `packages/web/src/setup-page.tsx`).

```html specimen id=source-rows title="First run: connected, waiting, and not available"
<ul class="provider-rows">
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">Epics, stories and their details</span>
      <span class="provider-status" data-connected>
        <span class="provider-mark" aria-hidden="true"></span>
        <span class="provider-state">Connected</span>
        <span>· SYN · 120 issues</span>
      </span>
    </div>
  </li>
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">F</span>
    <div class="provider-main">
      <span class="provider-name">A folder</span>
      <span class="provider-about"
        >Notes saved as files on this Mac, and its folders. Oriel only reads them.</span
      >
      <span class="cli-line cli-waiting" role="status"
        ><span class="spinner" aria-hidden="true"></span>Waiting for you to pick a folder…</span
      >
    </div>
  </li>
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">S</span>
    <div class="provider-main">
      <span class="provider-name">Google Sheets</span>
      <span class="provider-about">Trackers, RAID logs and plans you pick</span>
      <span class="cli-line"
        >Google Sheets can't be connected from this copy of Oriel yet: it doesn't have Oriel's
        Google sign-in.</span
      >
    </div>
  </li>
</ul>
```

### Narrow (≤760px)

Under 760px the row wraps: the main column takes at least 10rem, and a side action too wide to sit beside the words goes beneath them, at the right (`.provider-row` in `window.css`). The Settings sections become a wrapping row of links above the body (`.settings-sections` in `window.css`).

```html specimen id=narrow title="At 390: Install goes under the words" width=390
<ul class="provider-rows">
  <li class="provider-row" data-status="missing">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="cli-line">Not on this Mac yet.</span>
    </div>
    <div class="provider-side">
      <span class="cli-size">Free, about 310 MB</span>
      <button type="button" class="button">Install</button>
    </div>
  </li>
  <li class="provider-row connection-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">SYN on oriel.atlassian.net</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Synced just now</span><span>· 120 items</span></span
      >
    </div>
    <div class="provider-side"><button type="button" class="button">Sync</button></div>
  </li>
</ul>
```

## States

The row itself has no hover, focus or pressed look: it isn't a control. Its controls (the switch, Sync, Connect, the fields) carry their own states. What the row shows is the state of the thing it stands for, on its status line.

```html specimen id=state-focus title="Focus visible: the switch and the side action" state=focus-visible
<ul class="provider-rows">
  <li class="provider-row connection-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">SYN on oriel.atlassian.net</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Synced just now</span><span>· 120 items</span></span
      >
    </div>
    <div class="provider-side">
      <button type="button" class="button ws-focus-visible">Sync</button>
    </div>
  </li>
  <li class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span></span
      >
    </div>
    <button
      type="button"
      role="switch"
      class="switch ws-focus-visible"
      aria-checked="true"
      aria-label="Use Claude Code"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
</ul>
```

```html specimen id=state-busy title="Busy: syncing, and the switch off while it's off" state=busy
<ul class="provider-rows">
  <li class="provider-row connection-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">SYN on oriel.atlassian.net</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Syncing…</span><span>· 120 items</span></span
      >
    </div>
    <div class="provider-side"><button type="button" class="button" disabled>Sync</button></div>
  </li>
  <li class="provider-row" data-status="ready" data-off>
    <span class="provider-icon" aria-hidden="true">O</span>
    <div class="provider-main">
      <span class="provider-name">Codex<span class="provider-badge">Preview</span></span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span><span>Signed in · version 0.166.0</span></span
      >
    </div>
    <button type="button" role="switch" class="switch" aria-checked="false" aria-label="Use Codex">
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
</ul>
```

```html specimen id=state-disabled title="Disabled: a switch its source locks" state=disabled
<div class="settings-field settings-switch">
  <span class="settings-field-name">Oriel may propose changes</span>
  <span class="settings-field-about"
    >You can only view the Checkout v2 tracker, so Oriel can't propose changes to it.</span
  >
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="false"
    aria-label="Oriel may propose changes to Google Sheets"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

- **Rest**: the status line in its tone. Ready is `--done`; checking and off are `--text-faint`; anything else is `--danger`.
- **Hover**: none on the row. The switch has no hover look; buttons have theirs.
- **Focus visible**: the global ring on the switch, buttons and links. Fields in `.settings` draw it with no offset (`.settings :is(.input, .select):focus-visible` in `window.css`).
- **Active**: not styled.
- **Disabled**: Sync is disabled while it syncs. A locked switch is `disabled` at 0.5 with a not-allowed cursor (`.switch:disabled` in `window.css`); the app sets `data-locked` on its field, which has no CSS of its own. A disabled switch leaves the tab order, so the reason is in the field's about line, not a tooltip.
- **Busy**: the state word says it ("Syncing…", "Checking", "Looking for it on this Mac…") and the side action is disabled or becomes Cancel. A running step is `.cli-waiting` with a `.spinner` and `role="status"`; installing adds `.cli-bar`, which "moves to show it's going, never how far" (`.cli-bar` in `window.css`).
- **Error**: a connection's `.connection-problem` (`role="alert"`) under its status line; a provider's `.cli-box[data-tone="danger"]` (`role="alert"`) with Try again. A usage limit is `data-tone="warn"`.
- **Empty**: "Nothing is connected yet." as a `.settings-field-about` where the list would be (`Connections` in `packages/web/src/connections-page.tsx`).

## Keyboard and ARIA

- The row is an `<li>` in a `<ul>`; it isn't focusable. Tab reaches its controls in reading order: the fields, Undo, Disconnect, then the side action and the switch.
- The switch is `<button type="button" role="switch" aria-checked aria-label>`, so Enter and Space flip it (`Switch` in `packages/web/src/provider-row.tsx`). Its label names what it turns on: "Use Claude Code", "Oriel may propose changes to Jira". See [Switch](/components/switch).
- The mark is `aria-hidden="true"`; the name says it. The status dot is `aria-hidden="true"`; the state word carries the meaning, so colour is never the only signal.
- A running step is `role="status"`. A connection's problem and a provider's failure are `role="alert"`. What a change set is `role="status"`, or `role="alert"` when it carries a problem (`Said` in `packages/web/src/connections-page.tsx`).
- Disconnect's question is `role="alertdialog"` with `aria-label="Disconnect {name}?"`, in the row, not a modal.
- Show details sets `aria-expanded`.
- Each Settings section is a `<section aria-labelledby>` on its `.settings-title`. The sections nav is `<nav aria-label="Settings">` with `aria-current="page"` on the open one.

## Content

- **Name**: the provider's or connection's own name. A connection the person renamed shows its new name, and its about line starts with the connector: "Jira · SYN on oriel.atlassian.net".
- **About**: whose plans it's for, then who makes it ("For Claude Pro and Max · Anthropic's assistant for your Mac"), or what it reads ("Epics, stories and their details").
- **State**: one or two words, sentence case: Ready, Not signed in, Synced 3 min ago, Not synced yet, Waiting for options that fit, A problem. Detail after a "·": "· 120 items".
- **What it runs**: "Runs threads on {model}, titles on {title}", or "Not in use".
- **A running step**: what's happening, with "…" and the time: "Downloading from Anthropic… 0:41".
- **A failure**: one sentence, never more than Oriel knows, then the way on: Try again, Show details, Copy details.
- **Disconnect** names the connection: "Disconnect Jira". The question says what leaves and what stays: "Nothing changes in Jira."
- **A change**: "Set its name." with Undo; while it applies, "Setting its name…".

## Where the app uses it

- `ProviderRow`, its status line and its switch: `ProviderRow` in `packages/web/src/provider-row.tsx`. Settings › Providers lists them and draws the plain row: `Providers` in `packages/web/src/settings-page.tsx`.
- Claude Code and Codex: `ClaudeCodeRow` and `CodexRow` in `packages/web/src/cli-row.tsx`; the waiting line, `Waiting` in `packages/web/src/cli-row.tsx`; the failure box, `Failed` in `packages/web/src/cli-row.tsx`. Placed in Settings by `Providers` in `packages/web/src/settings-page.tsx`, and in the first run by `YourAi` in `packages/web/src/setup-page.tsx`.
- Connections: the row, its status line and Sync, `ConnectionRow` in `packages/web/src/connections-page.tsx`; options, `Options` in `packages/web/src/connections-page.tsx`; picked through a source server, `ServerPicks` in `packages/web/src/connections-page.tsx`; said and Undo, `Said` in `packages/web/src/connections-page.tsx`; Disconnect and its question, `Disconnect` in `packages/web/src/connections-page.tsx`. Add a connection: `AddConnection` in `packages/web/src/connections-page.tsx`.
- First run: `SourceRow` and `connected` in `packages/web/src/setup-page.tsx`; Reading's Done line, `Reading` in `packages/web/src/setup-page.tsx`.
- The training line: `TrainingLine` in `packages/web/src/cli-row.tsx`, from `trainingNotice` in `packages/web/src/training.ts`. Settings' other path and key: `CliPath` and `ApiKey` in `packages/web/src/settings-page.tsx`; CSS `.provider-path-open`, `.provider-key-actions` and `.provider-key-note` in `window.css`, and `.cli-training` with `.cli-note` in `window.css`.
- Settings frame, its sections and body: `SettingsPage` in `packages/web/src/settings-page.tsx`; a section head with its action, `Providers` in `packages/web/src/settings-page.tsx`.
- CSS: `.provider-rows`, `.provider-row`, `.provider-main`, `.provider-name`, `.provider-badge`, `.provider-preview`, `.provider-status`, `.provider-uses`, `.switch` and `.settings-field` in `window.css`; the status line's colours, `.provider-row[data-status="ready"] .provider-mark` and `.provider-row:is([data-status="checking"], [data-off]) .provider-mark` in `window.css`; connections, `.connection-options`, `.connection-row .provider-side`, `.connection-report` and `.connection-said` in `window.css`; narrow, `@media (max-width: 760px)` in `window.css`. The rest of the shell is in the first-run block: `.provider-icon`, `.provider-about`, `.provider-side`, `.provider-row[data-picked]` and `.provider-status[data-connected] .provider-mark` in `window.css`; the CLI pieces, `.cli-picked`, `.cli-line`, `.cli-waiting`, `.cli-note`, `.cli-size`, `.cli-box`, `.cli-actions`, `.cli-log`, `.cli-progress`, `.cli-bar` and `.spinner` in `window.css`. The Settings frame: `.settings`, `.settings-sections`, `.settings-body`, `.settings-section`, `.settings-head`, `.settings-title` and `.settings-lede` in `window.css`.
- The sidebar's source rows read the same connections but are nav rows: `Sources` in `packages/web/src/sidebar.tsx`. See [Sidebar](/components/sidebar).

## Drift

Status **drifting**. One shape, four authors, and a status line written seven times.

- **The row is hand-copied three times** beside `ProviderRow`: `ConnectionRow` in `packages/web/src/connections-page.tsx`, Add a connection's row (`AddConnection` in `packages/web/src/connections-page.tsx`) and the first run's `SourceRow` in `packages/web/src/setup-page.tsx`. Each writes `li.provider-row > span.provider-icon + div.provider-main + div.provider-side` again. Its CSS is split between the Settings block (`.provider-rows` in `window.css`) and the first-run block (`.provider-icon` in `window.css`).
- **The status line is written inline** in `provider-row.tsx`, `connections-page.tsx`, `cli-row.tsx` (twice) and `setup-page.tsx` (twice). The detail is a `.provider-detail` span in one, a bare `<span>· …</span>` in others.
- **Green is reached three ways**: the row's `data-status="ready"` (providers, connections, Claude Code's ready line), and `data-connected` on the line (the first run). Anything else falls back to `--danger`, so a status line moved out of a ready row turns red, and a state nobody gave a tone reads as an error.
- **Connection states don't map to tones.** A connection is "ready" when it's open with no problem, so "Syncing…" and "Not synced yet" are green like "Synced". With a standing problem, its next "Syncing…" is drawn in danger red. "Waiting for options that fit" is red too, though nothing is wrong. Nothing uses the faint "checking" tone here.
- **Dead classes**: `connection-rows`, `settings-page` and `provider-detail` have no CSS (`setup-rows` has one rule now, keeping a first-run row's side action at the top); `[data-locked]` has none either. They're hooks only.
- **The unpicked pick mark** says "Picked" to a screen reader (`ClaudeCodeRow` in `packages/web/src/cli-row.tsx`), the same as the picked one.
- `.cli-box` is also the Disconnect question and the first run's source failure, well beyond the CLI rows.

Until `ProviderRow` becomes the one row (rfc:R2 in the drift report, with a `StatusLine` that carries its own tone, cms:A5), **copy `ProviderRow`'s markup** (`ProviderRow` in `packages/web/src/provider-row.tsx`): `li.provider-row[data-status]` with the icon, the main column and the side, and the status line inside the main column. Set the tone on the row: `data-status="ready"` for green, `data-status="checking"` or `data-off` for faint, nothing for danger. Don't add a fourth copy: render `ProviderRow` with a `status` and a `side`, as `cli-row.tsx` does. Don't use `data-connected` for anything new. See [the drift report](/drift).
