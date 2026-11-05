---
title: First-run column
status: drifting
group: Layout
order: 76
classes: setup-page, setup-brand, setup, setup-steps, setup-step, setup-step-mark, setup-title, setup-lede, setup-note, setup-rows, setup-card, setup-form, setup-terminal, setup-command, setup-reading, setup-foot, setup-links, mark
summary: The first run's own page, with no sidebar: the brand, the two steps, a title and lede, the step's rows or card, and a foot with the ways out on the left and the one way on at the right.
---

# First-run column

## What it is

The first run (decision 0038) is a page of its own, before the window exists: "Your AI, then Your work, then reading it, then the overview. Each step has a way to set it up later" (`SetupPage` in `packages/web/src/setup-page.tsx`). It has no sidebar and no bar. The page is `.setup-page`, the brand sits at its top left (`.setup-brand`), and everything else is one centred column, `main.setup`: 40rem at most, `--space-4` between its parts.

Each screen in the column is built the same way, top to bottom:

1. **The steps** (`.setup-steps`): Your AI, then Your work, each a numbered mark. Not on the Reading screen.
2. **A title** (`h1.setup-title`), in the heading face, and **a lede** (`.setup-lede`) that says what this step is for and what Oriel won't do.
3. **The step's body**: [provider or source rows](/components/connection-row) (`ul.provider-rows.setup-rows`), or a card (`.setup-card`) holding a key, a connector's step, or the Terminal steps.
4. **Notes** (`.setup-note`), small and muted, for the why and the other ways in.
5. **The foot** (`.setup-foot`): ways out on the left, as link-shaped actions (`.setup-links`), and the one way on at the right, a bigger primary [button](/components/button#setup-next) (`.setup-next`).

## When to use it

- Only for the first run's screens: Your AI, Pay Anthropic per question, the Terminal steps, Your work, a connector's step and Reading your work.
- A new first-run screen copies this column: steps, title, lede, body, foot. Its one way on is `.setup-next`; every other way is a `.link-action` in the foot's links.

## When not to

- Not inside the window. Once the first run is done, the same choices live in Settings, in the [Settings frame](/components/connection-row), with the sidebar beside them.
- Not a wizard with more steps. The steps mark only Your AI and Your work; the key, the Terminal steps and a connector's step are part of one of the two, and Reading has no mark.
- Not `.setup-card` as a general card. It's the first run's frame for a form or a list of steps, and it follows `--list-frame`.

## Anatomy and variants

### The brand and the steps

```html specimen id=steps title="Step 1 of 2, then step 2 with step 1 done" pad=0
<div class="setup-page">
  <header class="setup-brand">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" />
    </svg>
    Oriel
  </header>
  <main class="setup" aria-busy="false">
    <ol class="setup-steps" aria-label="Setup">
      <li class="setup-step" aria-current="step">
        <span class="setup-step-mark" aria-hidden="true">1</span>Your AI
      </li>
      <li class="setup-step"><span class="setup-step-mark" aria-hidden="true">2</span>Your work</li>
    </ol>
    <ol class="setup-steps" aria-label="Setup">
      <li class="setup-step" data-done>
        <span class="setup-step-mark" aria-hidden="true">✓</span>Your AI
      </li>
      <li class="setup-step" aria-current="step">
        <span class="setup-step-mark" aria-hidden="true">2</span>Your work
      </li>
    </ol>
  </main>
</div>
```

- `.setup-step-mark` is a 1.25rem circle with a `--line-strong` border, `--text-xs`.
- The current step (`aria-current="step"`) is `--text` at `--weight-strong`, its mark filled with `--accent`. A done step (`data-done`) shows ✓ on `--done-soft`, in `--done`. The rest are `--text-faint`.
- Step 1 shows done only once the person is on step 2 and their AI is set.

### Title, lede and notes

```html specimen id=words title="Your AI's title, lede and the note while Claude Code isn't on this Mac"
<main class="setup">
  <h1 class="setup-title">Set up the AI Oriel uses</h1>
  <p class="setup-lede">
    Oriel answers your questions and drafts changes through Claude, on the Claude plan you already
    pay for. Nothing changes in Jira or your files or Google Sheets until you approve it.
  </p>
  <p class="setup-note">
    Oriel can't use claude.ai in your browser, so it works through Claude Code, Anthropic's free
    assistant for your Mac, which uses the same plan. Oriel installs it for you: no admin password,
    and nothing outside your own folder.
  </p>
</main>
```

The title is `--font-heading` at `--text-xl` and `--title-weight`, like a page title in the window. The lede is `--text-md` in `--text-muted`, the note `--text-sm`; both at `--leading-prose`.

### A card: the Terminal steps

When installing or signing in from Oriel keeps failing, the person can do it in Terminal. The steps are a numbered list in a card (`ol.setup-card.setup-terminal`), and the one line to paste sits in a mono box with Copy (`.setup-command`).

```html specimen id=terminal title="Install Claude Code yourself"
<main class="setup">
  <h1 class="setup-title">Install Claude Code yourself</h1>
  <p class="setup-lede">
    Only if installing from Oriel keeps failing. Terminal is the Mac's app for typing commands; this
    one line starts Anthropic's own installer and changes nothing else.
  </p>
  <ol class="setup-card setup-terminal">
    <li>
      Open Terminal: press <strong>⌘ Space</strong>, type <strong>Terminal</strong>, and press
      <strong>Return</strong>.
    </li>
    <li>
      Copy this line, paste it into Terminal, and press <strong>Return</strong>:
      <span class="setup-command"
        ><code>curl -fsSL https://claude.ai/install.sh | bash</code
        ><button type="button" class="button">Copy</button></span
      >
    </li>
    <li>When it says <strong>Installation complete</strong>, come back here and check again.</li>
  </ol>
  <p class="setup-note">
    Rather not?
    <button type="button" class="link-action">Pay Anthropic per question instead</button>.
  </p>
</main>
```

`.setup-card` is a grid with `--space-3` between its parts and `--space-4` padding, framed by `--list-frame` on `--list-bg`, so Broadsheet draws it open on the page. The API key screen and a connector's fields step put their form in one too (see [Connect steps](/patterns/connect-steps)); there, the screen is a `form.setup-form`, a grid with `--space-4` between its parts.

### The foot

```html specimen id=foot title="Your AI's foot: two ways out, one way on"
<main class="setup">
  <footer class="setup-foot">
    <div class="setup-links">
      <span
        >No Claude plan?
        <button type="button" class="link-action">Pay Anthropic per question instead</button></span
      >
      <button type="button" class="link-action">Set up later</button>
    </div>
    <button type="button" class="button primary setup-next">Continue with Claude Code</button>
  </footer>
</main>
```

The foot is a wrapping row, the links' column at the start and the button at the end. The links are a grid of `--text-sm` lines in `--text-faint`, each way out an accent `.link-action`. On a narrow page the button wraps under the links.

### Reading your work

While the first sync runs, a source's row carries a progress line (`.setup-reading`): what it's reading and how far, over a `progress.setup-progress` bar in the accent (see [Meter](/components/meter)).

```html specimen id=reading title="Reading Synthetic: 48 of 120 issues"
<ul class="provider-rows setup-rows">
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span>
      <span class="provider-about">Epics, stories and their details</span>
      <span class="setup-reading"
        ><span id="reading-jira" class="cli-line" role="status"
          >Reading Synthetic: 48 of 120 issues</span
        ><progress
          class="setup-progress"
          max="120"
          value="48"
          aria-labelledby="reading-jira"
        ></progress
      ></span>
    </div>
  </li>
</ul>
```

`.setup-rows` keeps a row's side action at the top beside its name, where a review step or a failure under it would otherwise push it halfway down (`.setup-rows .provider-side` in `window.css`).

## States

```html specimen id=state-busy title="Looking: the column is busy, and the lede says what for" state=busy
<main class="setup" aria-busy="true">
  <ol class="setup-steps" aria-label="Setup">
    <li class="setup-step" aria-current="step">
      <span class="setup-step-mark" aria-hidden="true">1</span>Your AI
    </li>
    <li class="setup-step"><span class="setup-step-mark" aria-hidden="true">2</span>Your work</li>
  </ol>
  <p class="setup-lede">Looking for Claude Code on this Mac…</p>
</main>
```

```html specimen id=state-disabled title="Nothing to continue with yet: the way on is disabled" state=disabled
<main class="setup">
  <footer class="setup-foot">
    <div class="setup-links">
      <button type="button" class="link-action">Skip for now</button>
    </div>
    <button type="button" class="button primary setup-next" disabled>Continue</button>
  </footer>
</main>
```

```html specimen id=state-focus title="Focus visible: a way out, and the way on" state=focus-visible
<main class="setup">
  <footer class="setup-foot">
    <div class="setup-links">
      <button type="button" class="link-action ws-focus-visible">Back</button>
    </div>
    <button type="button" class="button primary setup-next ws-focus-visible">Check again</button>
  </footer>
</main>
```

- **Busy:** before Oriel knows what's on this Mac, `main.setup` is `aria-busy` and the lede says "Looking for Claude Code on this Mac…". While a choice is being saved or tested, the way on is disabled and says so: "Checking that Claude Code answers…", "Checking it with Anthropic…".
- **Disabled:** Continue waits until there's something to continue with: an AI that's ready, a key typed, a source read. The ways out stay live, except Set up later while a choice is saving.
- **Error:** what failed for the page shows under the column as `.setup-problem` (see [Empty, loading and error](/components/states)); a row's own failure is in its row.
- **Done:** a step's mark turns to ✓.
- **Hover and focus:** the [button](/components/button)'s and the link action's own.

## Keyboard and ARIA

- The steps are `<ol aria-label="Setup">`, the current one `aria-current="step"`. The marks are `aria-hidden`, so a step reads as its name.
- Each screen has one `h1`, its `.setup-title`.
- `main.setup` is `aria-busy` until the first look at this Mac comes back.
- The foot's order is the reading order: the ways out, then the way on, so Tab reaches Continue last.
- The command to paste is a `<code>` with a Copy button beside it.
- A reading line is `role="status"`, so its count is read out as it moves.

## Content

- **Titles** say the step as a task: "Set up the AI Oriel uses", "Connect where your work lives", "Pay Anthropic per question", "Install Claude Code yourself", "Reading your work"; "Welcome back" when the first run resumes.
- **The lede** says what the step is for, then what Oriel won't do without the person: "Nothing changes in {where} until you approve it."
- **Steps** are two nouns: "Your AI", "Your work".
- **The way on** names what it continues with: "Continue with Claude Code", "Save and continue", "Check again", "Continue".
- **Ways out** are sentences in sentence case: "Set up later", "Skip for now", "Back", "Pay Anthropic per question instead".
- Plans before product names: "on the Claude plan you already pay for", then Claude Code as the way to it ([Voice](/content/voice)).

## Where the app uses it

- The page, the brand, the column and the problem line: `SetupPage` in `packages/web/src/setup-page.tsx`. The steps: `Steps` in `packages/web/src/setup-page.tsx`. The foot: `Foot` and `link` in `packages/web/src/setup-page.tsx`.
- The screens: `YourAi`, `ApiKey`, `OtherWays`, `YourWork`, `Connect` and `Reading` in `packages/web/src/setup-page.tsx`; the reading line, `ReadingLine` in `packages/web/src/setup-page.tsx`.
- The brand's mark: `Mark` in `packages/web/src/parts.tsx`.
- CSS: `.setup-page`, `.setup-brand`, `.setup`, `.setup-steps`, `.setup-step`, `.setup-step-mark`, `.setup-step[aria-current]`, `.setup-step[data-done] .setup-step-mark`, `.setup-title`, `.setup-lede`, `.setup-note`, `.setup-foot`, `.setup-links`, `.setup-form`, `.setup-terminal`, `.setup-command`, `.setup-reading` and `.setup-rows .provider-side` in `window.css`; the card, `.setup-card` in `window.css`.

## Drift

Status **drifting**.

- **Back is two buttons.** In the first run it's a `.link-action` in the foot or in the step's actions; Settings' Add a connection says Back as a `.quiet-action` (see [Connect steps](/patterns/connect-steps#drift)).
- **"Nothing changes in your files."** The lede joins every offered source's `changes` with "or", so with a folder offered it reads "Nothing changes in Jira or your files or Google Sheets until you approve it", while the folder's own row says "Oriel only reads them" (`changesIn` in `packages/web/src/setup-page.tsx`).
- **Copy says nothing.** The Terminal steps' Copy copies the line and shows no sign it did: its message, `lineCopied`, only copies (`OtherWays` in `packages/web/src/setup-page.tsx`).
- **A nameless bar.** The reading `<progress>` has no accessible name in the app (`ReadingLine` in `packages/web/src/setup-page.tsx`). The specimen names it with `aria-labelledby` to the line above, as [Meter](/components/meter#reading-a-source) does; a new one should too.
- The problem line sits under the foot, after the way on, not beside what failed.

Copy the column as it is for a new first-run screen: steps, `h1.setup-title`, `.setup-lede`, the body, and `Foot` with one `.setup-next`.
