---
surveyed: 85a125e9
---

# Drift report

Where Oriel's window has several versions of one thing, and how to make each one thing once. The counts below are recounted live on the [web page](/drift#the-counts).

**A dated snapshot.** First surveyed on 2026-11-04 at Oriel `5ee7a339`; re-surveyed on 2026-11-05 at `85a125e9`, on `main`, after Noticed (0052), chart blocks (0053), the second look (0054) and the bead (0056). Every `file:line` here is `85a125e9`'s, and a line link opens the file as it was then; D1, done by OA-251, cites its places by name. `pnpm check` doesn't check line links, so a stale line never fails the build. A story built from this re-reads `main` before it starts, and `pnpm -s ds where <name>` prints where a selector or symbol is today.

Each proposal below is written to be pasted into a story: why, where, what differs, the proposed component with its API and classes, a migration, a size, and what to watch for. They're ranked by value for effort. Value is how much drift a person sees, plus bugs fixed, plus what it unblocks. Effort is **S** (under a day: a few files, no component API), **M** (a component and a sweep of its call sites) or **L**.

## The ranking

| #   | Proposal                                                                                                          | Value    | Effort | Size                                              | Decided 2026-11-05                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------- | ------------------------------------- |
| 1   | [Clear dead and split CSS, and the reduced-motion miss](#d1-clear-dead-and-split-css-and-the-reduced-motion-miss) | High     | S      | 1 file, ~45 CSS lines removed                     | OA-251: done, and one pulse speed     |
| 2   | [One disabled look, and one button-kind rule](#d2-one-disabled-look-and-one-button-kind-rule)                     | High     | S      | 2 TSX files, ~25 CSS lines removed, 6 added       | OA-252: one label for Approve         |
| 3   | [One ChatInput for the four places a person asks](#d3-one-chatinput-for-the-four-places-a-person-asks)            | High     | M      | 5 TSX files, ~70 CSS lines removed, ~45 added     |                                       |
| 4   | [One focus for fields, and a ring for menu items](#d4-one-focus-for-fields-and-a-ring-for-menu-items)             | Med–High | S      | 0–2 TSX files, ~25 CSS lines removed, 8 added     | OA-253: an inset ring on menu items   |
| 5   | [One SearchField](#d5-one-searchfield)                                                                            | High     | S      | 2–4 TSX files, ~32 CSS lines removed              |                                       |
| 6   | [ProviderRow everywhere, with one StatusLine](#d6-providerrow-everywhere-with-one-statusline)                     | High     | S      | 5 TSX files, ~25 CSS and ~40 TSX lines removed    |                                       |
| 7   | [One ListFrame that follows the theme](#d7-one-listframe-that-follows-the-theme)                                  | High     | S      | 6–8 TSX files, ~35 CSS lines removed, 12 added    | Yes, not yet filed                    |
| 8   | [One state-to-colour map](#d8-one-state-to-colour-map)                                                            | High     | M      | 8 TSX files, ~60 CSS lines removed, 25 added      | OA-255: draft and reply in the accent |
| 9   | [One IconButton, and an SVG close](#d9-one-iconbutton-and-an-svg-close)                                           | High     | M      | 7 TSX files, ~150 CSS lines removed, 35 added     |                                       |
| 10  | [One Problem line](#d10-one-problem-line)                                                                         | High     | M      | 13 TSX files, ~90 CSS lines removed, 25 added     |                                       |
| 11  | [One Field: label, hint and error, tied together](#d11-one-field-label-hint-and-error-tied-together)              | High     | M      | ~8 TSX files, ~60 CSS lines removed               |                                       |
| 12  | [One Empty line](#d12-one-empty-line)                                                                             | Medium   | S      | 11 TSX files, ~45 CSS lines removed               |                                       |
| 13  | [One reveal-on-hover rule](#d13-one-reveal-on-hover-rule)                                                         | Medium   | S      | 5 TSX files, ~35 CSS lines removed, 6 added       |                                       |
| 14  | [Customizable selects](#d14-customizable-selects)                                                                 | Medium   | S      | 2–3 TSX files, ~40 CSS lines replaced             | “Add to…” stays a select              |
| 15  | [Layer and spacing tokens](#d15-layer-and-spacing-tokens)                                                         | Low–Med  | S      | 1 file; 11 z-index and ~30 rem literals to tokens | OA-251: the `--layer-*` scale, done   |

Suggested order: 1 and 2 first (no visible change but fixes), then 4 with 3 (focus first, so ChatInput uses the frame), then 5–7, then 8, then 9 with a `Button` component, then 10 and 11, then the rest. Smaller drift that didn't make a story is [at the end](#also-seen).

The maintainer decided six questions these proposals asked on 2026-11-05; each is marked **Decided** where it's asked, with the story that carries it.

## The counts

Oriel's own theme check already holds colours, font sizes, weights, radii, border widths, shadows and durations to tokens (decision 0034), and window.css has **no** literal colour outside a theme block. Spacing literals are allowed by 0034, and that's where copies of one thing drift apart: not as literals, mostly, but as different choices of token (`--radius` against `--radius-sm`, `--text-muted` against `--text-faint`, `--text-sm` against `--text-md`).

On 2026-11-05, at `85a125e9` (2026-11-04's counts in brackets):

- 36 raw `px` values outside token blocks (31; 11 are still 1px or 2px hairline gaps). New: the timeline's bars, due and today marks (`window.css:3217`, `window.css:3244`, `window.css:3253`), the bead's inset ring (`window.css:4580`) and its mark's panes (`window.css:4720`);
- 59 raw `rem` values in padding, margin, gap or inset that aren't a `--space-*` token (55). New: the timeline's due and today marks (`window.css:3242` to `window.css:3252`), `.bead-layer` (`window.css:4506`) and `.noticed-pinned` (`window.css:5725`); gone with the undo stack: its lift over the selection bar;
- 11 `z-index` literals, with no scale (11): 20 and 1 are each used twice. The bead's 22 (`window.css:4404`) and 1 (`window.css:4425`) replace the undo stack's and the closing problem's two 22s;
- 5 selectors written as more than one top-level rule (4): `.shell` and `.shell-main`, three times each now that the bead adds one to each (`window.css:4384`, `window.css:4802`); `.connect-actions`; `.connect-problem`; and `.timeline-count`, twice in a row (`window.css:3183`, `window.css:3187`);
- 2 classes styled but never named in the app (2): `.section-count`, `.setup-box`.

```live
census
```

---

## D1. Clear dead and split CSS, and the reduced-motion miss

**Done** (OA-251). The dead rules are gone, `.badge` with them; each split rule is one rule; `.bar-menu` keeps its 2rem; and the reduced-motion block stills `.cli-bar::after`. It also moved to the end of `window.css`: the install bar's and the spinner's rules came after it, so they won and kept moving.

**Why.** No visible change, except one fix. It clears ground for every story below, and two of the split rules have already drifted.

**Places and what differed.** As it was at `5ee7a339`, by name:

- Dead: `.setup-box` and its three rules, and `.section-count`, were never rendered. `.nav-link .badge` styled a `.badge` the app doesn't draw.
- Split in two, thousands of lines apart:
  - `.connect-actions`: the second rule added `justify-content` and a `:last-child` margin.
  - `.connect-problem`: the first rule was wholly contained in the second.
  - `.shell`: the second rule set `--panel` and `--beside`, which the window chat, the selection bar and the bead read too.
  - `.tabs a` got `text-decoration: none` on its own, far from the tabs' rule.
  - `.bar-menu` was sized 1.75rem with the sidebar fold, then resized to 2rem in the narrow bar's rules.
- The reduced-motion block stopped `.cli-bar`'s animation, but the animation runs on `.cli-bar::after`, so the install bar kept sliding for a person who asked for less motion.

**Proposal.** Delete the dead rules. Merge each split rule into its later home. Move `--panel` and `--beside` to the first `.shell` rule. Make the reduced-motion selector `.cli-bar::after`.

**Migration.** One commit in `window.css`. Run `pnpm shots` in both themes, light and dark; expect no change but the install bar under reduced motion.

**Size.** 1 file, ~45 CSS lines removed.

**Watch for.** `.bar-menu` is focused by class (`App` in `packages/web/src/app.tsx`): keep the class. Pick the 2rem size or the 1.75rem one on purpose; D9 settles icon-button sizes.

**Done when.** The census shows 0 split selectors and 0 dead classes, and `pnpm check` is green.

---

## D2. One disabled look, and one button-kind rule

**Why.** Three controls look live while they're disabled. A person clicks and nothing happens.

**Decided 2026-11-05** (OA-252): one label for Approve wherever it does the same thing. The thread says **Approve and apply**, the review link page **Approve** (`packages/web/src/other-pages.tsx:350`); OA-252 makes them one.

The bead (0056) replaced the stack of Undo notes. Its own action, `.bead-action` (`window.css:4560`), has what this asks for: a hover guarded with `:not(:disabled)` (`window.css:4574`) and a disabled look (`window.css:4583`). `.undo-action` still lacks both, and `UndoButton` and a reply's two Undos still draw it beside the change they undo, so D2 stands.

**Places.**

- Disabled with no disabled look:
  - `.undo-action` outside the action lines: `packages/web/src/undo-stack.tsx:553`, `packages/web/src/thread-page.tsx:613`. Its hover (`window.css:4833`) isn't guarded either, so a disabled Undo still lights up.
  - `.remove-line`, the change set line's ×: `disabled={props.busy}` at `packages/web/src/thread-page.tsx:1194`, no rule, and a danger hover that isn't guarded (`window.css:2421`).
  - `.ask-question`, the questions under the ask bar: disabled while asking (`packages/web/src/window-chat-view.tsx:82`), but its own `color` (`window.css:6062`) stops the browser's grey.
- Five disabled looks where there are disabled rules: opacity 0.5 (`window.css:370`, `window.css:392`, `window.css:2349`, `window.css:6796`), 0.35 (`window.css:5073`), 0.5 with a not-allowed cursor (`window.css:6432`), and a colour change only (`window.css:2929`).
- Button kinds chosen per page: "Try again" is a `.button`, a `.button.primary` and a `.quiet-action`; "Cancel" is `.button`, `.quiet-action` and `.link-action`; "Dismiss" is a `.quiet-action` (a Noticed card's, too), and a `.bead-action` in the bead, which is the bead's own ink and fine. See [Button](/components/button#drift).

```html specimen id=disabled-today title="Disabled today: these four are all disabled" side=today
<div class="ws-row">
  <button type="button" class="button" disabled>Sync</button>
  <button type="button" class="undo-action" disabled>Undo</button>
  <button type="button" class="ask-question" disabled>What moved in Payments?</button>
  <span class="ws-note">and the change set's × lights red on hover while busy</span>
</div>
```

**Proposal.** A token and one rule, not a component:

```css
html {
  --disabled: 0.5;
} /* the shared block */
:is(button, a):is(:disabled, [aria-disabled="true"]) {
  opacity: var(--disabled);
  cursor: default;
}
```

Every hover rule becomes `:hover:not(:disabled, [aria-disabled="true"])`. And one rule for kinds, written into the [Button](/components/button) page: retry is a `.button` beside what failed (primary only when it's the step's own way on); Cancel is a `.button` in a form or dialog, a `.quiet-action` elsewhere; Dismiss is a `.quiet-action`.

**Migration.**

1. Add the token to the shared `html` block (`window.css:3`) and the rule to the Buttons section (`window.css:340`).
2. Delete the per-class disabled rules listed above. Decide whether the panel steps keep 0.35 and whether a locked switch keeps not-allowed.
3. Guard the hovers: `.undo-action`, `.remove-member`/`.remove-line`, `.window-chat-close`, `.panel-close`, `.fold-toggle`, `.cluster-toggle`.
4. Replace the hand-rolled Undo at `packages/web/src/thread-page.tsx:387` with `UndoButton`.
5. Move the "Try again", "Cancel" and "Dismiss" call sites onto the rule.

**Size.** 2 TSX files, ~25 CSS lines removed, 6 added.

**Watch for.** `.overview-make` starts at opacity 0 and is revealed on hover (`window.css:5936`): reveal and disabled both use `opacity`, so do D13 with this, or reveal with `visibility`.

---

## D3. One ChatInput for the four places a person asks

**Why.** The maintainer's lead case. Four versions of the most-used control in Oriel, three looks, and the weakest focus in the app on the field people use most.

**Places.**

1. The overview's ask bar: `packages/web/src/window-chat-view.tsx:49`, CSS `window.css:6013` to `window.css:6077`, off state `window.css:7136`.
2. The window chat's composer: `Composer` used twice, `packages/web/src/window-chat-view.tsx:176` and `packages/web/src/window-chat-view.tsx:187`.
3. A thread's composer: `Composer` at `packages/web/src/thread-page.tsx:1211`, CSS `window.css:2525` to `window.css:2564`, sticky at `window.css:3859`.
4. A workstream's Ask box, a hand copy of `Composer`: `packages/web/src/workstream-page.tsx:162`.

Today, from the app (`pnpm shots`, Graphite light):

![The ask bar on the overview: a tall one-line field, with Ask outside it](/assets/drift/chat-ask-bar.png)

![The window chat's composer: Ask a follow-up, with Stop inside the frame](/assets/drift/chat-window-chat.png)

![A thread's composer: Ask about 17 items…, with Send inside the frame, raised](/assets/drift/chat-thread.png)

![A workstream's Ask box: Ask about these 17 items…, with Ask inside, flat](/assets/drift/chat-workstream.png)

The same four, with today's markup and Oriel's live CSS beside the proposal, in every state and theme: [Chat input](/components/chat-input#today-side-by-side).

**What differs.**

|                 | Ask bar                          | Window chat                                         | Thread                  | Workstream                    |
| --------------- | -------------------------------- | --------------------------------------------------- | ----------------------- | ----------------------------- |
| Field           | `<input>`, 2.375rem, `--text-lg` | `<textarea>`, grows                                 | `<textarea>`, grows     | `<textarea>`, grows           |
| Frame           | on the input                     | on the form, `--shadow` inside a shadowed panel     | on the form, `--shadow` | on the form, no shadow        |
| Submit          | outside, centred                 | inside, at the foot                                 | inside, at the foot     | inside, at the foot           |
| Label           | Ask                              | Send                                                | Send                    | Ask                           |
| Stop            | no                               | with a thread                                       | yes                     | no                            |
| Send key        | Enter always (decision 0041)     | Settings' key                                       | Settings' key           | Settings' key, handler copied |
| Focus           | 2px ring on `:focus`             | 1px border tint                                     | 1px border tint         | 1px border tint               |
| Error           | `.ask-problem`                   | `.ask-problem` and `.composer-notice`, both at once | `.composer-notice`      | `.notice` outside the form    |
| Accessible name | "Ask about your window"          | "Message"                                           | "Message"               | "Ask about this workstream"   |
| Theme mark      | Broadsheet's `--ask-mark`        | none                                                | none                    | none                          |

Two hidden couplings: the workstream's form is `class="composer ask"`, so it takes the overview's `.ask` section margin (`window.css:6013`); and the ask bar and the window chat's first composer edit one draft, so both show and mirror each other after New chat.

**Proposal.** `ChatInput`, in a new file of its own, chat-input.tsx beside the pages, so no page imports another. Its CSS is written and judged by Oriel's own literal rule in this workshop: `assets/proposals/chat-input.css`.

```ts
export type ChatInputProps = {
  draft: string;
  placeholder: string;
  label: string; // the accessible name; keep each place's ("Message"…)
  lines?: "one" | "grow"; // one: <input>, Enter always asks (0041). grow: <textarea>, sends()
  size?: "md" | "lg"; // lg: the ask bar
  submitLabel?: "Send" | "Ask";
  busy: boolean; // submit disabled while busy or blank
  running?: boolean; // with onStop, Stop replaces submit
  onStop?(): void;
  notice?: string | null; // the one error line, inside the frame, role="alert"
  elevation?: "raised" | "flat"; // raised in a thread only
  marked?: boolean; // the theme's --ask-mark
  off?: { placeholder: string; action: ComponentChildren }; // no AI set up
  extra?: ComponentChildren; // "Back to the chat"
  onDraft(text: string): void;
  onSubmit(): void;
  class?: string; // a placement hook only
};
```

```html
<form class="chat-input" data-lines="grow" data-elevation="raised">
  <textarea
    class="chat-input-field"
    rows="2"
    aria-label="Message"
    placeholder="Ask about 17 items…"
  ></textarea>
  <button type="submit" class="button primary">Send</button>
  <p class="chat-input-notice" role="alert">…</p>
</form>
```

**Migration.**

1. Add `chat-input.tsx` and its CSS where "Composers: where the user asks" starts (`window.css:2523`). Keep `composer` as a second class for now: `packages/web/src/effects.ts:104` and the sticky rule select it.
2. Make `Composer` a thin wrapper of `ChatInput lines="grow"`, move its four call sites, and drop the cross-page import at `packages/web/src/window-chat-view.tsx:9`.
3. Replace the workstream's copy with `ChatInput label="Ask about this workstream" submitLabel="Ask"`. Give it its own margin and drop `ask` from its class.
4. Replace the ask bar's two forms with `ChatInput lines="one" size="lg" marked`, and the no-AI form with `off`.
5. Show one error line in the window chat.
6. Use one placeholder rule: `askPrompt` (`packages/web/src/workstream.ts:279`) for threads and workstreams alike. This changes thread shots' text; ask first.
7. Delete `window.css:2525` to `window.css:2564`, `window.css:6019` to `window.css:6045` and `window.css:7135` to `window.css:7138`.
8. `pnpm shots` both themes, light and dark, 1280 and 390, and the first run.

**Size.** 5 TSX files (one new), about −70 and +80 TSX lines; ~70 CSS lines removed, ~45 added.

**Watch for.**

- Decision 0041: the ask bar stays one line, and Enter always asks. Don't run it through `sends()`.
- `--ask-mark` is a theme token; `packages/web/test/themes.test.ts` asserts a sketch's sheet never carries it. Apply it through `marked`.
- Shots find `.ask-input`, the button named exactly "Ask", the textbox "Message" and the label "Ask about this workstream" (`scripts/shots.ts:1555`, `scripts/shots.ts:2921`, `scripts/shots.ts:3752`). Keep those names; keep `ask-input` as a class on the field.
- Keep `ChatInput` fully controlled: two of them share one draft on the overview.
- The keyboard path skips the button's `disabled`; the reducers guard empty and busy sends (`packages/web/src/thread.ts:280`). Keep the guard there.

---

## D4. One focus for fields, and a ring for menu items

**Decided 2026-11-05** (OA-253): keyboard focus on a menu item is an inset ring, distinct from hover.

**Why.** Accessibility. A field shows focus five ways, and the composer's is a 1px border tint, barely visible. In the context menu, keyboard focus looks exactly like the pointer's hover, so with the pointer on one item and the arrows on another, two items are lit and nothing says which one Enter picks.

**Places.**

- The global ring: `window.css:335`, 2px of `--focus`, 2px out.
- `.ask-input:focus` (on `:focus`, not `:focus-visible`), ring 1px in: `window.css:6042`.
- `.composer:focus-within`, a border mixed halfway to the accent, with `outline: none` on the textarea: `window.css:2537`, `window.css:2551`.
- `.sidebar-search-field:focus-within` and `.filter-search:focus-within`: border and a 1px ring, written twice: `window.css:545`, `window.css:1681`.
- `.workstream-title:focus`: a border only: `window.css:2293`.
- `.settings` fields: the ring at offset 0: `window.css:6359`.
- `.context-menu-item:is(:hover, :focus-visible)`: one fill for both, `outline: none`: `window.css:4318`.
- The bead's actions already draw the inset ring this proposes, in the bead's own accent, with a literal offset: `.bead-action:focus-visible` (`window.css:4578`).

**Proposal.** Tokens on the shared `html` block, the global ring rewritten with them, one field-frame rule, and an inset ring for full-width rows:

```css
html {
  --focus-ring: var(--border-thick) solid var(--focus);
  --focus-offset: 2px;
  --focus-inset: calc(-1 * var(--border-thick));
}
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
/* A field's frame shows focus, whatever inside has it. */
:is(.chat-input, .search-field, .text-field-control):focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 var(--border-thin) var(--focus);
}
:is(.context-menu-item, .cluster-toggle, .tabs button):focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-inset);
}
```

The field frame is the sidebar search's look today, the strongest of the five, and the one [ChatInput](/components/chat-input#proposed-focus) and the [text field lab](/lab/text-field) use.

**Migration.** Add the tokens. Replace the five field focus rules with the frame rule as D3, D5 and D11 land; until then, change `.composer:focus-within` to the frame look (two lines). Drop `outline: none` from `.context-menu-item` and give it the inset ring. Leave the programmatic focus targets (`.change-set:focus`, `.panel-title:focus`) ring-less. Move `.bead-action:focus-visible` onto `--focus-inset`, keeping its colour.

**Size.** 0–2 TSX files, ~25 CSS lines removed, 8 added.

**Watch for.** A 2px outside ring on the sticky composer can clip against the window chat's scrolling column; the frame's border-and-ring stays inside. Broadsheet's `--ask-mark` sits beside the ask bar's ring: check both together in Broadsheet light and dark. The inset ring on menu items changes how the context menu looks (see [Menu](/components/menu)); decided, as above.

---

## D5. One SearchField

**Why.** Two searches with byte-identical CSS, written twice.

**Places.** The sidebar's thread search: `packages/web/src/sidebar.tsx:178`, CSS `window.css:531` to `window.css:562`. Browse's item search: `packages/web/src/window-page.tsx:154`, CSS `window.css:1667` to `window.css:1698`. Two more searches without the icon frame: `packages/web/src/connect-steps.tsx:166`, `packages/web/src/connections-page.tsx:467`.

```html specimen id=search-sidebar title="The sidebar's search (.sidebar-search-field)" side=today
<label class="sidebar-search-field">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </svg>
  <span class="visually-hidden">Search threads</span>
  <input
    type="text"
    role="combobox"
    autocomplete="off"
    placeholder="Search threads"
    aria-expanded="false"
    aria-autocomplete="list"
  />
</label>
```

```html specimen id=search-browse title="Browse's search (.filter-search): the same CSS" side=today
<label class="filter-search">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </svg>
  <span class="visually-hidden">Search items</span>
  <input
    type="search"
    autocomplete="off"
    placeholder="Search items by key or title"
    maxlength="200"
  />
</label>
```

**What differs.** Only `flex: 1` against `flex: 1 1 16rem`. The input rules are identical (7 of 7 declarations), the frames share 10 of 12, and `:focus-within` and `::placeholder` are identical. Behaviour differs by need: the sidebar's is a combobox; Browse's is `type="search"`.

**Proposal.** `SearchField`:

```ts
type SearchFieldProps = {
  label: string; // visually hidden
  placeholder: string;
  value: string;
  onInput(text: string): void;
  combobox?: {
    listId: string;
    expanded: boolean;
    activeId?: string;
    onKeyDown(e: KeyboardEvent): void;
  };
  maxLength?: number;
  grow?: string; // flex basis, such as "16rem"
};
```

Markup `label.search-field > svg.icon + span.visually-hidden + input`. The class and its CSS are in the [text field lab](/lab/text-field) (`assets/proposals/field.css`).

**Migration.** Add `.search-field` as a copy of `window.css:531`. Swap both labels' classes. Delete `window.css:1667` to `window.css:1698`. Optionally move the two picker searches onto it.

**Size.** 2–4 TSX files, ~32 CSS lines removed.

**Watch for.** The folded sidebar hides its search by class (`window.css:1094`): keep a sidebar hook, or scope by `.sidebar`.

---

## D6. ProviderRow everywhere, with one StatusLine

**Why.** One row shape, written by hand four more times, and a visible bug: a connection that is "Syncing…" or "Signed out" draws its status in danger red, because only a row that sets `data-status="ready"` escapes the default.

**Places.** The component: `ProviderRow` at `packages/web/src/provider-row.tsx:63`. Hand copies: `ConnectionRow` (`packages/web/src/connections-page.tsx:88`), the add-a-connection row (`packages/web/src/connections-page.tsx:528`), the first run's `SourceRow` (`packages/web/src/setup-page.tsx:372`). The status line written inline again at `packages/web/src/connections-page.tsx:103`, `packages/web/src/setup-page.tsx:387`, `packages/web/src/cli-row.tsx:214` and `packages/web/src/cli-row.tsx:377`. "Ready" is coloured twice: `window.css:6292` and `window.css:6832`.

Seen side by side: [Connection and provider rows](/components/connection-row#status-tones).

**Proposal.** Split `ProviderRow` into `SettingRow` and `StatusLine`; `ProviderRow` becomes a caller.

```ts
type Tone = "ready" | "off" | "checking" | "problem" | "busy";
type SettingRowProps = {
  id?: string;
  mark: ComponentChildren;
  name: ComponentChildren;
  about?: ComponentChildren;
  status?: { tone: Tone; label: string; detail?: ComponentChildren };
  side?: ComponentChildren; // one action, or a switch
  picked?: boolean;
  class?: string;
  children?: ComponentChildren; // options and steps under the row
};
```

Markup stays `li.provider-row > .provider-icon + .provider-main + .provider-side`; colour keys off `.provider-status[data-tone]`, so it works wherever the line sits.

**Migration.** Add `StatusLine` and move the colour rules to `[data-tone]`. Make `SettingRow` from `ProviderRow`'s JSX. Replace the three hand rows and four hand status lines. Delete `window.css:6292` to `window.css:6306` and `window.css:6832` to `window.css:6839`, and move `window.css:6802` beside `window.css:6220`.

**Size.** 5 TSX files, ~25 CSS lines and ~40 TSX lines removed.

**Watch for.** The first run's shots wait on `.provider-status[data-connected]` (`scripts/shots-first-run.ts:503`): keep it as an alias or update the script. `scripts/check-repo.ts` fails any web file that names a source kind, so the row takes every name from the connector. Syncing in green, not red, is a visible change: say so in the PR.

---

## D7. One ListFrame that follows the theme

**Decided 2026-11-05** (not yet filed): Broadsheet's lists follow `--list-frame` everywhere, Browse's and a workstream's included.

**Why.** Broadsheet's "open lists on the page" (`--list-frame: none`, `--list-bg: var(--bg)`) reaches the overview and Settings but not Browse or a workstream's items, which keep a frame and a white surface. Three ways of writing a rule between rows, in two strengths.

**Places.** Following the theme: `.overview-rows` (`window.css:5558`), `.provider-rows` (`window.css:6220`), `.choice-rows` (`window.css:7071`), `.setup-card` (`window.css:6705`), and since the survey Noticed's cards, `.noticed-card` (`window.css:5648`). Not: `.members` (`window.css:2354`) and `.clusters` (`window.css:1769`), each with a hard-coded `--line` frame and `--surface`; nor a second look's suggested additions, `.second-look .suggested li` (`window.css:3505`), framed in `--line` on `--surface` inside a dashed, sunk box.

Seen in Broadsheet: [the overview's rows](/components/list-row?theme=broadsheet#workstream-rows) against [a workstream's items](/components/list-row?theme=broadsheet#members).

**Proposal.** `ListFrame`, CSS first:

```css
.list-frame {
  margin: 0;
  padding: 0;
  list-style: none;
  border: var(--list-frame);
  border-radius: var(--radius-lg);
  background: var(--list-bg);
}
.list-frame > * + * {
  border-top: var(--border-thin) solid var(--list-rule, var(--line));
}
.list-frame[data-rule="soft"] {
  --list-rule: color-mix(in srgb, var(--line) 60%, transparent);
}
```

```ts
type ListFrameProps = {
  as?: "ul" | "ol" | "div";
  rule?: "line" | "soft";
  themed?: boolean;
  class?: string;
  children: ComponentChildren;
};
```

**Migration.** Add the class beside `.overview-rows`. Add it to the six lists, keeping their own classes for shape and for shots. Delete the duplicated frames and the four separator rules. `.members` and `.clusters` follow the theme (decided), so Browse and workstream pages change in Broadsheet: say so in the PR. A second look's suggestions sit in a box of their own; leave them framed unless they read as a list on the page.

**Size.** 6–8 TSX files (class additions), ~35 CSS lines removed, 12 added.

**Watch for.** `.clusters` needs `overflow: clip` for its radius. `.members.compact` in the right rail (`window.css:3922`) has no frame: leave it off. `.overview-candidates` is a `div` of `ul`s; the separator rule must not reach its groups.

---

## D8. One state-to-colour map

**Decided 2026-11-05** (OA-255): "Draft to apply" and "Your turn" take the accent, as part of one state-to-colour map.

**Why.** Five maps turn a state into a colour, and they disagree. The accent means "your move" (decision 0034), yet a thread waiting on a draft to apply, or on the person's reply ("Your turn"), is drawn in the in-progress blue in the sidebar and its state chip, while "Needs review" and "Message held" take the accent. A dropped thread's state chip has no rule and shows as to-do grey.

**Places.** `.state-chip` (`window.css:1325`), `.state-dot` (`window.css:831`), the sidebar's waiting word (`window.css:809`), the chip's state (`window.css:1407`, map in `packages/web/src/chip.ts:47`), `.status` (`window.css:2141`), the provider mark (`window.css:6278`). `waitingNames` at `packages/web/src/parts.tsx:571`. Since the survey, the bead keeps a sixth, on its ink: `--bead-working`, `--bead-done`, `--bead-danger` and `--bead-accent` (`window.css:45` to `window.css:48`), each a state colour mixed toward the paper. It follows the same states, so it should read from the same tones (`--tone` on ink), not a parallel list.

Seen side by side: [State chip, status and counts](/components/badge#state-chip).

**Proposal.** A tone vocabulary and one CSS block:

```ts
// packages/web/src/tone.ts
export type Tone = "todo" | "progress" | "you" | "done" | "dropped" | "danger" | "quiet";
export function threadTone(state: ThreadStateId, waitingOn: WaitingOn | null): Tone;
export function itemTone(category: "todo" | "in-progress" | "done" | undefined): Tone;
export function changeSetTone(state: ChangeSetState): Tone;
```

```css
[data-tone] {
  --tone: var(--todo);
  --tone-soft: var(--todo-soft);
}
[data-tone="progress"] {
  --tone: var(--in-progress);
  --tone-soft: var(--in-progress-soft);
}
[data-tone="you"] {
  --tone: var(--accent);
  --tone-soft: var(--accent-soft);
}
/* done, danger, quiet; dropped draws a ring */
```

Every pill, dot and status reads `var(--tone)` and `var(--tone-soft)`. `data-pulse` stays separate.

**Migration.** Add `tone.ts` with a unit test that pins today's mapping. Put `draft` and `reply` on the accent (decided); **decide** the dropped pill. Move `StateChip` and the dots first, keeping `data-state` and `data-waiting` for shots; then the chip, `.status` and the provider rows (with D6). Delete the per-class maps.

**Size.** 8 TSX files (one new), ~60 CSS lines removed, 25 added.

**Watch for.** The five scanned states must stay apart (decision 0034's CIEDE2000 check); a tone map doesn't add colours, so it can't break that. Shots read `.reply .chip[data-state]` (`scripts/shots.ts:3204`). Moving draft and reply to the accent is a visible change.

---

## D9. One IconButton, and an SVG close

**Why.** Nine square icon buttons in five sizes, two radii, three rest colours and three disabled looks. The item panel's close and the window chat's close sit on the same header line at different sizes, and only one answers Esc. Closes are a "×" character, so their weight follows the font.

**Places.** `.sidebar-fold` and `.bar-menu` (`packages/web/src/sidebar.tsx:61`, `packages/web/src/app.tsx:312`), `.head-action` (`packages/web/src/end-workstream.tsx:62`), `.panel-step` and `.panel-close` (`packages/web/src/item-panel.tsx:91`, `packages/web/src/item-panel.tsx:123`), `.window-chat-close` (`packages/web/src/window-chat-view.tsx:136`), `.sync-now` (`packages/web/src/thread-page.tsx:1291`), `.remove-member` and `.remove-line` (`packages/web/src/parts.tsx:708`, `packages/web/src/thread-page.tsx:1194`).

Seen side by side, at rest and in every state: [Icon button](/components/icon-button#all-today).

**Proposal.** `IconButton` and a `CloseIcon`, beside `Chevron` in `packages/web/src/parts.tsx:623`:

```ts
type IconButtonProps = {
  label: string; // always aria-label
  tip?: string; // Tooltip; defaults to label
  keys?: string; // "Esc", "↑": shown in the tip, set as aria-keyshortcuts
  icon: ComponentChildren; // an svg.icon
  size?: "sm" | "md"; // sm 1.75rem, md var(--head-row)
  tone?: "default" | "danger";
  disabled?: boolean; // aria-disabled, so it stays focusable with its tip
  busy?: boolean;
  reveal?: boolean; // D13
  onClick(): void;
};
```

```html
<button
  type="button"
  class="icon-button"
  data-size="md"
  aria-label="Close the panel"
  aria-keyshortcuts="Escape"
>
  <svg class="icon">…</svg>
</button>
```

**Migration.** Add the component and one `.icon-button` rule (~20 lines). Move `.head-action` first (the one to copy today), then the steps, the closes, Sync now, the fold and the menu, then the removes. Keep old classes as hooks where scripts or code select them. Settle the window chat's close at `--head-row` and give it Esc.

**Size.** 7 TSX files, ~150 CSS lines removed (`window.css:491` to `window.css:511`, `window.css:2327` to `window.css:2352`, `window.css:2387` to `window.css:2425`, `window.css:3893` to `window.css:3920`, `window.css:4974` to `window.css:4991`, `window.css:5055` to `window.css:5076`, `window.css:6120` to `window.css:6133`), ~35 added.

**Watch for.** `.remove-member` is how the workstream page moves focus between rows (`packages/web/src/workstream-page.tsx:62`); shots select `.sync-now`, `.head-action[data-danger]` and `.window-chat-close`. Moving `disabled` to `aria-disabled` puts buttons back in the tab order: guard their clicks. `.bar-count` sits on the fold and the menu; keep `position: relative`.

---

## D10. One Problem line

**Why.** About 22 classes say something went wrong, in three colours, with four kinds of retry, and several aren't read out. A load failure is grey in two places and red everywhere else.

**Places.** Inline lines: `.ask-problem`, `.composer-notice`, `.notice[data-tone="error"]`, `.connect-problem`, `.connection-problem`, `.source-problem`, `.selection-notice`, `.panel-problem`, `.confirm-problem`, `.run-error`, `.line-error`, `.apply-errors`, `.overview-problem`. Boxes: `.failed`, `.settings-problem` and `.setup-problem` (identical), `.change-set-problem`. The bead (0056) took `.closing-problem`: a close from a list that failed is a bead failure now, with Dismiss. Since the survey: Noticed's load failure reuses `.overview-problem`; a second look that didn't finish says so in `.second-look-note` (`packages/web/src/second-look.tsx:60`), faint and not read out, on purpose, since 0054 keeps the second look out of the danger colours. No `role="alert"` on `packages/web/src/connections-page.tsx:204`, `.run-error` or `.apply-errors`.

```html specimen id=problems-today title="Four error lines today: red, red, red with a retry, and grey with a retry" side=today
<div class="ws-stack">
  <p class="connect-problem" role="alert">Type your Jira address, like yourteam.atlassian.net.</p>
  <p class="notice" data-tone="error" role="alert">
    Nothing that was dropped names an item. Drop an item, or a link to one.
  </p>
  <p class="panel-problem" role="alert">
    Oriel can't be reached. Is it still running?
    <button type="button" class="quiet-action">Try again</button>
  </p>
  <p class="overview-problem" role="alert">
    Oriel can't be reached. Is it still running?
    <button type="button" class="quiet-action">Try again</button>
  </p>
</div>
```

All of them: [Empty, loading and error](/components/states#error-lines).

**Proposal.** `Problem`:

```ts
export function Problem(props: {
  children: ComponentChildren; // what went wrong, and what to do
  look?: "line" | "box" | "band"; // line: danger text; box: danger-soft with a radius; band: a card's foot
  retry?: { label?: string; onClick(): void }; // a quiet-action, "Try again" by default
  dismiss?(): void;
  as?: "p" | "div" | "li" | "span";
  live?: boolean; // default true: role="alert"
}): JSX.Element;
```

```html
<p class="problem" data-look="line" role="alert">
  The window didn't load. <button type="button" class="quiet-action">Try again</button>
</p>
```

**Migration.** Merge the duplicated problem selectors (D1). Add `.problem`. Port the inline lines, then the boxes and bands. **Decide** whether a page that "didn't load" is red and always offers Try again (the thread and workstream models need a retry message). Move "This thread was deleted." (`packages/web/src/thread-page.tsx:111`) off `.failed`: it isn't an error.

**Size.** 13 TSX files, ~90 CSS lines removed, 25 added.

**Watch for.** Wording is product copy: only the shell changes. Leave the bead's failure in the bead. Give the second look's "It didn't finish" `role="alert"` but keep it neutral, as 0054 asks: a `look="quiet"`, or leave it out.

---

## D11. One Field: label, hint and error, tied together

**Why.** Five label wrappers and about ten input looks, and no error is tied to its field with `aria-describedby`, so a screen reader hears "invalid" without the reason. `.input` changes size with where it sits.

**Places.** `.connect-field`, `.name-field`, `.provider-path-label`, `.settings-field`, the folder path field, `.held-field`, `.workstream-title`. See [Text field](/components/text-field#drift) and the [Forms pattern](/patterns/forms).

**Proposal.** `Field` and `Input`, with the CSS in the [text field lab](/lab/text-field):

```ts
type FieldProps = {
  label: string;
  hint?: ComponentChildren;
  problem?: string | null; // sets aria-invalid and ties the line with aria-describedby
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => VNode;
};
```

It uses `:user-invalid` beside `[aria-invalid]` (Baseline), `field-sizing: content` for growing text (replacing the JS row count at `packages/web/src/thread-page.tsx:537`), and the field-frame focus from D4.

**Migration.** Add `Field`. Move the connect fields first (they already set `aria-invalid`), then Settings, the review page's name and reason, and the held message. The review page opens in any browser: check it degrades (it does; see the lab).

**Size.** ~8 TSX files, ~60 CSS lines removed.

**Watch for.** Shots find fields by label ("Path to Claude Code", `scripts/shots.ts:1579`): keep the labels.

---

## D12. One Empty line

**Why.** Eleven classes for "there's nothing here", muted or faint and small or not with no rule for which. `.rail-empty`, a right-rail name, is used on main pages, in the sidebar, for search status and for a deleted page.

**Places.** `.rail-empty` (`window.css:1281`), `.rail-note` (`window.css:3881`), `.window-chat-empty` (`window.css:6142`), `.no-items` (`window.css:2013`), `.no-matches` (`window.css:1716`), `.overview-quiet` (`window.css:5499`), `.panel-empty`, `.connect-none` (`window.css:7065`), and `.settings-field-about` borrowed for "Nothing is connected yet." (`packages/web/src/connections-page.tsx:46`). Since the survey: `.noticed-none` (`window.css:5730`), faint and small, for both "Nothing Oriel found needs you now." and a pin whose read is gone; and `.second-look-none` (`window.css:3451`), muted and full size, for a second look that raised nothing.

Seen side by side: [Empty, loading and error](/components/states#empty).

**Proposal.** `Empty({ children, action?, as?: "p" | "li", size?: "md" | "sm", band?: boolean })` rendering `p.empty[data-size]`: one colour (`--text-faint`), two sizes, and the way out when there is one (Clear filters, Add from the window).

**Migration.** Add `.empty`. Replace the per-place classes; keep `.no-items`'s band padding as `data-band`. Move search status and "Deleted…" to a status line. Delete `.rail-empty` last.

**Size.** 11 TSX files, ~45 CSS lines removed.

**Watch for.** Shots read `.workstream-page .rail-empty` (`scripts/shots.ts:2369`) and rely on `.rail-empty:empty` hiding search status.

---

## D13. One reveal-on-hover rule

**Why.** Four versions of "show this action when the row is pointed at": one with a transition, some on `:focus-within`, some only on the button's own focus, and 1, 0.6 or 0.7 on touch. The overview's and Browse's "Make a workstream" sit next to each other and reveal differently, and are worded differently ("Make workstream" in Browse).

**Places.** `.make-workstream` (`window.css:1819`), `.overview-make` (`window.css:5936`), `.source-sync` (`window.css:1027`), `.remove-member` and `.remove-line` (`window.css:2398`), and the `.pick` checkbox (`window.css:2065`).

**Proposal.** A pair of attributes, not a component:

```css
@media (hover: hover) {
  [data-reveal-host]:not(:hover, :focus-within) [data-reveal] {
    opacity: 0;
  }
}
[data-reveal] {
  transition: opacity var(--duration-quick);
}
```

**Migration.** Mark the hosts (`.cluster-head`, `.overview-candidate`, `.source-row`, `.member`, the diff line) and the actions; delete the four reveal blocks; settle touch at fully shown. Use "Make a workstream" in both places.

**Size.** 5 TSX files, ~35 CSS lines removed, 6 added.

**Watch for.** The opacity clash with disabled (D2). `.overview-make` has no vertical padding so revealing it never moves rows; keep that.

---

## D14. Customizable selects

**Decided 2026-11-05** (no story): "Add to…" stays a select.

**Why.** Four native selects with four borders, three heights and a focus override.

**Places.** Browse's filters (`packages/web/src/window-page.tsx:126`, `window.css:1700`), "Add to…" (`packages/web/src/window-page.tsx:620`, `window.css:2255`), the Settings model picker (`packages/web/src/settings-page.tsx:424`, `window.css:6346`), and since the survey a pivot block's two picks (`packages/web/src/charts.tsx:377`, `.pivot-pick select` at `window.css:3279`), 1.75rem high with a `--radius` border of its own.

**Proposal.** `appearance: base-select` with Oriel's picker, a native fallback styled like Oriel's fields, and rich options (a state dot per status, a count per workstream, a line per model). Built and tested in the [select lab](/lab/select); the [controls report](/controls) has the verdict.

**Migration.** Add `.dropdown` from `assets/proposals/select.css`; move the four selects, "Add to…" included (it stays a select); replace the JS-set `data-set` with `:has(option[value=""]:checked)`. A pivot block never reaches the review link page, so its picks may take the base-select too.

**Size.** 2–3 TSX files, ~40 CSS lines replaced.

**Watch for.** Don't put `label=` on a rich option (it hides the content). A base-select sizes to the chosen option, so give filters a min-width.

---

## D15. Layer and spacing tokens

**Layers done** (OA-251): every `z-index` is a `--layer-*` token on `html`, in today's order, with `--layer-raised`, `--layer-float` and `--layer-sheet` added so no two layers share a value they didn't before. See [Space, shape and elevation](/foundations/space). The spacing half is still open.

**Why.** 11 `z-index` literals with no scale (20 and 22 each used twice), and the same small paddings written as rem literals over and over (0.125rem thirteen times).

**Why.** 11 `z-index` literals with no scale (20 and 1 each used twice; the bead's 22 at `window.css:4404` is the top one now), and the same small paddings written as rem literals over and over (0.125rem fourteen times, `.noticed-pinned` the newest).

**Proposal.** A `--layer-*` set on the shared `html` block (`--layer-sticky`, `--layer-bar`, `--layer-panel`, `--layer-drawer`, `--layer-veil`, `--layer-toast` for the bead), and `--space-0_5: 0.125rem` beside the space scale, with the 0.25rem, 0.5rem and 1rem literals moved onto existing `--space-*` tokens. See [Space, shape and elevation](/foundations/space).

**Size.** 1 file; brings the census to 0 z-index literals and about 25 rem literals.

**Watch for.** `--space-*` are theme tokens (a theme sets density through them); a control's own padding moving onto them makes it follow Broadsheet's density. That may be wanted; check both themes.

---

## Also seen

Smaller drift, worth a line in a story that's nearby:

- **Two section heads.** The overview's `.overview-head` follows the theme's section tokens; `.section-title` on every other page doesn't ([Overview sections](/components/overview-section)).
- **Approve's label.** The thread says **Approve and apply**; the review link page hard-codes **Approve** (`packages/web/src/other-pages.tsx:350`). **Decided 2026-11-05** (OA-252): one label wherever it does the same thing. See D2.
- **Destructive confirmation.** Delete asks in a modal with Cancel focused; Disconnect asks inline with Disconnect first ([Confirm dialog](/components/confirm)).
- **"N more"** has four shapes ([Long lists](/patterns/long-lists)).
- ~~**The pulse** runs at 1.6s on a state dot and 1.2s on the working dot and Sync now~~. Done (OA-251): one `--pulse`, 1.6s ([Motion](/foundations/motion)).
- **Disclosures**: chevron buttons with the rotation written three times, and `<summary>` with the browser's own triangle (drift research B6).
- **Link-shaped buttons** in seven looks: `.link-action`, `.overview-more`, `.overview-stat`, `.item-link`, `.line-error .quiet-action`, `.undo-action`, and the bead's `.bead-action` on its ink.
- **Item rows** drawn three ways; Browse's skips the shared `TypeMark` and `ItemKey` ([List rows](/components/list-row)).
- **The switch** in dark schemes: an off switch's knob is `--on-accent`, dark on a dark track ([Switch lab](/lab/switch)).
- **A quote from a source** is drawn three ways. In a reply, a left rule in the accent when the check found it word for word, in danger when not (`window.css:2716`, `window.css:2720`). In a second look, always `--line-strong` (`window.css:3493`), as 0054 keeps it neutral. On a Noticed card, no rule at all: `.reply blockquote` doesn't reach the overview, so the card's `<blockquote>` takes the browser's indent and only the accent colour of a rule it doesn't have (`packages/web/src/noticed-strip.tsx:115`). One `.quote-from` rule outside `.reply` would give all three the same frame.
- **Small capitals** written six times, each with its own size, weight and colour: `.rail-title`, `.derived-tag`, `.search-label`, `.line-mark`, `.overview-headline-label` (`window.css:5775`), and since the survey `.noticed-kind` (`window.css:5667`), a copy of the headline label but for its cursor.
- **An information mark** as a character: a Noticed card's "Oriel's rule" and "About Dismiss" are each an ⓘ in a focusable `<span>` (`.noticed-rule-mark`, `packages/web/src/noticed-strip.tsx:92`, `packages/web/src/noticed-strip.tsx:160`), not an icon; its weight follows the font, as the "×" closes do (D9).
- **The accent on checkboxes and radios** is set three times: #173 put `accent-color` on `html` (`window.css:294`), and `.pick input` (`window.css:2074`) and `.choice input` (`window.css:6503`) still set it again. The connect steps' radios, which showed the browser's blue at the survey, take the accent now.
- **Accessibility**: item chips have only a `title`, no `aria-label`; the first run's `.cli-picked` says "Picked" whether or not the row is picked; the reading `<progress>` has no name.
