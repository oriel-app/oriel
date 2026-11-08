---
title: First run › Your AI
order: 5
summary: The desktop app's first screen on a fresh data folder, with Claude Code already on this Mac and signed in: the steps, both AIs, and Continue with Claude Code.
---

# First run › Your AI

## What it shows

The first thing a person sees in the desktop app, on a fresh data folder, when their Claude Code is already installed and signed in with a Pro plan (decision 0038). It's step 1 of 2. Claude Code is ready and picked, so the way on names it: **Continue with Claude Code**. Codex is on this Mac too, signed in with ChatGPT Plus, and shows as the preview it is, not picked. Both are personal plans, so each row says its vendor may train on the person's chats. The foot offers the one way out: setting the AI up later.

The onboarding budget's clock starts here (SPEC §1): this screen is meant to take one click.

```html specimen id=screen title="Your AI: Claude Code ready and picked, Codex beside it" screen height=760
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
    <h1 class="setup-title">Set up the AI Oriel uses</h1>
    <p class="setup-lede">
      Oriel answers your questions and drafts changes through Claude, on the Claude plan you already
      pay for. Nothing changes in Jira or your files or Google Sheets until you approve it.
    </p>
    <ul class="provider-rows setup-rows">
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
          <p class="cli-training">
            Your plan may let Anthropic train on your chats.
            <a
              href="https://claude.ai/settings/data-privacy-controls"
              target="_blank"
              rel="noreferrer"
              >Check your setting</a
            >
          </p>
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
          <span class="provider-preview"
            >Less locked down than Claude Code: your own Codex settings still load, and Oriel can't
            check every tool Codex gives its model.</span
          >
          <span class="provider-status"
            ><span class="provider-mark" aria-hidden="true"></span
            ><span class="provider-state">Ready</span><span>· Plus</span></span
          >
          <p class="cli-training">
            Your plan may let OpenAI train on your chats.
            <a href="https://chatgpt.com/#settings/DataControls" target="_blank" rel="noreferrer"
              >Check your setting</a
            >
          </p>
        </div>
        <div class="provider-side">
          <span class="cli-picked" role="img" aria-label="Not picked"></span>
        </div>
      </li>
    </ul>
    <footer class="setup-foot">
      <div class="setup-links">
        <button type="button" class="link-action">Set up later</button>
      </div>
      <button type="button" class="button primary setup-next">Continue with Claude Code</button>
    </footer>
  </main>
</div>
```

## Built from

- [First-run column](/components/setup-column): the page, the brand, the steps, the title and lede, and the foot with its links.
- [Connection and provider rows](/components/connection-row): Claude Code and Codex, their status lines, the pick marks, the Preview badge and its line, and the training lines.
- [Button](/components/button): Continue with Claude Code (`.setup-next`), and the link-shaped Not this account? and Set up later.

## Notes for review

- **Five lines of small print before Continue.** With both AIs on personal plans, the rows carry a preview warning and two training lines, each faint `--text-sm`. They're true and each is needed once, but on the one screen meant to take one click, the eye reads three cautions before it finds the button.
- **"Nothing changes in your files."** The lede names every source the first run offers, the folder's "your files" among them, while the folder's own row on the next screen says "Oriel only reads them" (see [First-run column](/components/setup-column#drift)).
- **The unpicked mark says "Picked".** The app gives Codex's empty mark the same `aria-label` as Claude Code's (see [Connection rows](/components/connection-row#drift)); this screen says "Not picked", as it should.
- **Picking isn't a control.** The marks are images; the person picks by which AI is ready, and Continue says which. With both ready, Claude Code wins (decision 0048) and there's no way here to choose Codex instead, short of turning Claude Code off later in Settings.
- **The brand isn't a link.** Unlike the window's brand, the first run's is plain text: there's nowhere to go yet.
