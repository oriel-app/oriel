---
title: Forms and validation
order: 40
summary: Labels that say what to type, hints beside the field, a submit that waits for what's required, the server's one sentence on submit, and the fields it names marked invalid. Not yet tied to the field for a screen reader.
---

# Forms and validation

## The problem

Oriel has few forms, and each is a moment someone would rather skip: connecting Jira, pointing at Claude Code, typing a name on a review link. A form that scolds before they've finished, or fails with "Invalid input", costs more than the form is worth. One that fails and loses what they typed costs more still.

## The pattern

1. **Every field has a visible label** that says what to type in the person's words ("Your Jira address", "The email you sign in to Jira with"), and a **hint** under it when there's something to know ("The start of the address in your browser when Jira is open."). A placeholder shows the shape ("yourteam.atlassian.net"); it never replaces the label.
2. **The page checks only that what's required is there.** The submit button is disabled until every required field has something in it (`trim() !== ""`). There's no format check in the page: not for an address, an email, a path or a key.
3. **The server checks the rest, on submit,** and answers with one sentence that says what's wrong and what to do: "Type your Jira address, like yourteam.atlassian.net." For a connector's step it also names the fields at fault, which the page marks `aria-invalid` (a `--danger` border, `.input[aria-invalid]` in `window.css`).
4. **The error is one paragraph with `role="alert"`**, after the fields and before the buttons, so it's read out when it appears.
5. **It clears as the person fixes it.** Typing in a field the error named drops the field's mark (`updateConnections` in `packages/web/src/connections.ts`).
6. **Nothing typed is lost**, and help stays on screen after a refusal (OA-125): the refusal can point at it ("make a new one (step 2)").
7. **The button says what's happening** while it works, the verb's -ing form: **Connecting…**, **Checking it with Anthropic…**, **Reading…**.

Validation never runs on blur. A field that saves on its own (a rename, a connection's name) saves on blur or Enter, and doesn't check.

```html specimen id=refused title="Connect Jira, refused: two fields marked, one sentence, help kept"
<div class="setup-card">
  <form class="connect-details" aria-label="Your Jira account">
    <div class="connect-fields">
      <label class="connect-field"
        ><span class="connect-label">Your Jira address</span
        ><input
          class="input"
          name="site"
          type="text"
          autocomplete="url"
          spellcheck="false"
          autocapitalize="off"
          placeholder="yourteam.atlassian.net"
          value="synthetic.atlassian.net"
        /><span class="connect-hint"
          >The start of the address in your browser when Jira is open.</span
        ></label
      >
      <label class="connect-field"
        ><span class="connect-label">The email you sign in to Jira with</span
        ><input
          class="input"
          name="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          autocapitalize="off"
          placeholder="you@company.com"
          value="amara@synthetic.example"
          aria-invalid="true"
      /></label>
      <label class="connect-field"
        ><span class="connect-label">API token</span
        ><input
          class="input"
          name="token"
          type="password"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
          placeholder="Paste it here"
          value="not-a-real-token"
          aria-invalid="true"
      /></label>
      <p class="connect-problem" role="alert">
        Jira didn't accept these two together. Check the email is the one you sign in to Jira with.
        If it is, make a new one (step 2) and paste it here.
      </p>
    </div>
    <div class="connect-help">
      <p>
        Atlassian lets you make these for apps like Oriel. One has your Jira access and no more,
        Oriel changes Jira only when you approve, and you can delete it on Atlassian's page any
        time.
      </p>
      <ol>
        <li>
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            >Open Atlassian's page for them</a
          >
          (it opens in your browser).
        </li>
        <li>
          Click <strong>Create</strong>, name it <strong>Oriel</strong>, pick when it expires (a
          year is fine), and click <strong>Create</strong>.
        </li>
        <li>Click <strong>Copy</strong>, then paste it above. Atlassian shows it only once.</li>
      </ol>
    </div>
    <div class="connect-actions">
      <button type="button" class="link-action">Back</button
      ><button type="submit" class="button primary">Connect</button>
    </div>
  </form>
</div>
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
    <button type="submit" class="button primary" disabled>Connecting…</button>
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
- Answer a refusal with one sentence that says what to do, and mark the fields it names `aria-invalid`.
- Clear a field's mark as soon as the person types in it.
- Keep what they typed, and keep the help in view.
- Say what's happening on the button, with its own verb: **Connect** becomes **Connecting…**, **Save and continue** becomes **Checking it with Anthropic…**.
- Use the input kinds that help without blocking: an address is `type="text" autocomplete="url"` (not `type="url"`, so the browser never refuses "acme"); a secret is `type="password" autocomplete="off"`.

## Don't

- Don't validate on blur, or while someone is typing.
- Don't say "Invalid", "Error" or "Something went wrong" when you know what's wrong.
- Don't put the error far from the form, as the top of a page: Settings does today for a path or a key (`.settings-problem`); see Drift.
- Don't clear the form after a refusal.
- Don't rely on the placeholder as the label.

## Where Oriel does it

- **Connect Jira**, the model to copy: `FieldsStep` in `packages/web/src/connect-steps.tsx`, drawn from Jira's declaration, `jiraConnect` in `packages/jira/src/connecting.ts`. Submit waits for `typedAll` in `packages/web/src/connections.ts`. The server's sentences and the fields they name: `refusedCredentials` in `packages/jira/src/connecting.ts`. CSS `.connect-field`, `.input[aria-invalid]`, `.connect-problem` and `.connect-help` in `window.css`.
- **The path to Claude Code** (Settings › Providers, the desktop app): `CliPath` in `packages/web/src/settings-page.tsx`. Save waits for something typed, not for it to be valid. A refusal ("Give the full path to the claude program, such as /opt/homebrew/bin/claude.") shows once at the top of Settings (`SettingsPage` in `packages/web/src/settings-page.tsx`), with no `aria-invalid`.
- **The first run's API key**: `ApiKey` in `packages/web/src/setup-page.tsx`, "Save and continue" → "Checking it with Anthropic…", its error under the field with `aria-invalid`.
- **The review link's name**: "Type your name first.", checked on click in the page (`updateReview` in `packages/web/src/review.ts`), shown under the card; the buttons aren't disabled for an empty name, and the field gets no `aria-invalid`. See [Change set › The review link page](/components/change-set#the-review-link-page).
- **A folder's typed path**: `FolderStep` in `packages/web/src/connect-steps.tsx`, "Type the folder's full path, starting with / or ~."

### Drift

- Where an error shows differs by form: under the fields (connect steps, the first run's key), at the top of Settings (the path, the key in Settings), under the card (the review link). There are about a dozen classes for the one job (`.connect-problem`, `.settings-problem`, `.change-set-problem`, `.confirm-problem`, `.composer-notice`…).
- Only the connect steps and the first run's key set `aria-invalid`; Settings' path and key, a folder's typed path and the review link's name don't.
- `.connect-field input` is styled twice over: by its own rule and again by `.connect-details .input`, which always wins (`.connect-field input` and `.connect-details .input` in `window.css`).

Until a Field component settles it, **copy `FieldsStep`**: visible labels, hints, submit disabled until typed, the server's sentence in a `role="alert"` paragraph under the fields, and `aria-invalid` on the fields it names.
