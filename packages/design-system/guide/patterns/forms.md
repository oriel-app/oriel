---
title: Forms and validation
order: 40
summary: Labels that say what to type, notes beside the field, a submit that waits for what's required, the server's one sentence on submit, and the field it's about marked invalid. Not yet tied to the field for a screen reader.
---

# Forms and validation

## The problem

Oriel has few forms, and each is a moment someone would rather skip: pointing at Claude Code, pasting a key, typing a folder's path, typing a name on a review link. A form that scolds before they've finished, or fails with "Invalid input", costs more than the form is worth. One that fails and loses what they typed costs more still.

## The pattern

1. **Every field has a visible label** that says what to type in the person's words ("API key", "A folder of markdown files, by its path"), and a **note** near it when there's something to know ("Oriel reads its .md files and never changes them."). A placeholder shows the shape ("~/notes", "Paste it here"); it never replaces the label.
2. **The page checks only that what's required is there.** The submit button is disabled until every required field has something in it (`trim() !== ""`). There's no format check in the page: not for a path or a key.
3. **The server checks the rest, on submit,** and answers with one sentence that says what's wrong and what to do: "Type the folder's full path, starting with / or ~." A field it's about is marked `aria-invalid` (a `--danger` border, `.input[aria-invalid]` in `window.css`).
4. **The error is one paragraph with `role="alert"`**, after the field and before the buttons, so it's read out when it appears.
5. **It clears as the person fixes it.** Typing in the field drops the error and its mark (`updateSetup` in `packages/web/src/setup.ts`).
6. **Nothing typed is lost**, and help stays on screen after a refusal (OA-125), so the refusal can point at it.
7. **The button says what's happening** while it works, the verb's -ing form: **Checking it with Anthropic…**, **Reading…**.

Validation never runs on blur. A field that saves on its own (a rename, a connection's name) saves on blur or Enter, and doesn't check.

```html specimen id=refused title="The first run's API key, refused: the field marked, one sentence, help kept"
<form class="setup-form">
  <div class="setup-card">
    <label class="connect-field"
      ><span class="connect-label">API key</span
      ><input
        class="input"
        type="password"
        name="key"
        value="not-a-real-key"
        placeholder="Paste it here"
        spellcheck="false"
        autocomplete="off"
        aria-invalid="true"
    /></label>
    <p class="connect-problem" role="alert">
      Anthropic doesn't accept that key. Copy it again from Anthropic's page, and paste it here.
    </p>
    <p class="cli-note">
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
        >Get a key from Anthropic</a
      >: make an account there (it's separate from claude.ai), add a card, click
      <strong>Create Key</strong>, and copy it.
    </p>
  </div>
  <footer class="setup-foot">
    <div class="setup-links"><button type="button" class="link-action">Back</button></div>
    <button type="submit" class="button primary setup-next">Save and continue</button>
  </footer>
</form>
```

```html specimen id=waiting title="Waiting for what's required, then busy"
<div class="ws-stack">
  <form class="provider-path">
    <label class="provider-path-label"
      ><span>Path to Claude Code</span
      ><input
        type="text"
        class="input"
        placeholder="/opt/homebrew/bin/claude"
        spellcheck="false"
        autocomplete="off"
    /></label>
    <button type="submit" class="button" disabled>Save</button>
  </form>
  <div class="connect-actions">
    <button type="submit" class="button primary" disabled>Checking it with Anthropic…</button>
  </div>
</div>
```

### Errors and the field they're about

Today the error sentence isn't tied to its field for a screen reader: no field in Oriel has `aria-describedby` pointing at its error or its hint (the only `aria-describedby` in the app are a tooltip's and the confirm dialog's body). A reader hears the alert once, then "invalid" on the fields, without the reason. Until a [Field](/lab/text-field) component does it, a new form should:

- give its error paragraph an `id`, and put it in each named field's `aria-describedby`, after the hint's `id`;
- keep the paragraph `role="alert"` and in the same place.

The [text field lab](/lab/text-field) proposes `:user-invalid` for the look, so a field shows invalid only after the person has touched it or submitted, with `aria-invalid` from the server still winning. It's a proposal; nothing in the app uses it yet.

## Do

- Label every field visibly, in the person's words. Put what they need to know in a hint, not the placeholder.
- Disable submit until what's required is there; let the server judge the rest.
- Answer a refusal with one sentence that says what to do, and mark the field it's about `aria-invalid`.
- Clear a field's mark as soon as the person types in it.
- Keep what they typed, and keep the help in view.
- Say what's happening on the button, with its own verb: **Add** becomes **Reading…**, **Save and continue** becomes **Checking it with Anthropic…**.
- Use the input kinds that help without blocking: a path is `type="text"` with `spellcheck` off; a key is `type="password" autocomplete="off"`.
- Ask for what Oriel can't get another way. A source's sign-in is its server's, in the person's agent (decision 0059), never a form of Oriel's.

## Don't

- Don't validate on blur, or while someone is typing.
- Don't say "Invalid", "Error" or "Something went wrong" when you know what's wrong.
- Don't put the error far from the form, as the top of a page: Settings does today for a path or a key (`.settings-problem`); see Drift.
- Don't clear the form after a refusal.
- Don't rely on the placeholder as the label.

## Where Oriel does it

- **The first run's API key**, the model to copy: `ApiKey` in `packages/web/src/setup-page.tsx`, "Save and continue" → "Checking it with Anthropic…", its error under the field with `aria-invalid`, cleared as the person types (`updateSetup` in `packages/web/src/setup.ts`). CSS `.connect-field`, `.connect-label`, `.input[aria-invalid]` and `.connect-problem` in `window.css`.
- **The path to Claude Code** (Settings › Providers, the desktop app): `CliPath` in `packages/web/src/settings-page.tsx`. Save waits for something typed, not for it to be valid. A refusal ("Give the full path to the claude program, such as /opt/homebrew/bin/claude.") shows once at the top of Settings (`SettingsPage` in `packages/web/src/settings-page.tsx`), with no `aria-invalid`.
- **The review link's name**: "Type your name first.", checked on click in the page (`updateReview` in `packages/web/src/review.ts`), shown under the card; the buttons aren't disabled for an empty name, and the field gets no `aria-invalid`. See [Change set › The review link page](/components/change-set#the-review-link-page).
- **A folder's typed path**: `FolderStep` in `packages/web/src/connect-steps.tsx`, "Type the folder's full path, starting with / or ~."

### Drift

- Where an error shows differs by form: under the field (a folder's path, the first run's key), at the top of Settings (the path, the key in Settings), under the card (the review link). There are about a dozen classes for the one job (`.connect-problem`, `.settings-problem`, `.change-set-problem`, `.confirm-problem`, `.composer-notice`…).
- Only the first run's key sets `aria-invalid`; Settings' path and key, a folder's typed path and the review link's name don't.
- The first run's key is styled twice over: by `.connect-field input` and again by `.setup-form .input`, which wins where they differ (both in `window.css`).

Until a Field component settles it, **copy `ApiKey`**: a visible label, submit disabled until typed, the server's sentence in a `role="alert"` paragraph under the field, `aria-invalid` on the field it's about, and its help kept in view.
