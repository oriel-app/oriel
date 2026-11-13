# Oriel design system

A component workshop for Oriel: its foundations, components, patterns and a few composed screens, with guidance on when to use each. It runs a local server you flip through in a browser, and every page is plain markdown a builder can `cat`.

Specimens are styled by **Oriel's own `window.css`, read live from the checkout** on every request, so the workshop shows what the app ships today, and changes when the app does. Proposals (consolidations and new controls) live in this package's `assets/proposals/`, are marked **proposed**, and sit beside today's version.

## Run it

From the repo's root:

```sh
pnpm design         # http://localhost:4400
pnpm ui-check       # every check, the accessibility pass in headless Chrome too
pnpm -s ds <page>   # a page as plain text, its live tables filled in
```

- Node runs the `.ts` files directly. There's no build step and no runtime dependency: the server is `node:http`, the markdown reader is ~250 lines in `src/md.ts`, and the browser code is two small scripts.
- It reads the checkout it's in by default. Point it at another, such as your worktree: `ORIEL=../my-story pnpm design`. It only reads; nothing here writes to Oriel.
- `PORT=4401 pnpm design` if 4400 is taken. Port 4310 is the live Oriel; this never touches it. The server listens on 127.0.0.1 and answers only requests addressed to this machine. It shows only files git tracks, or would: never `.env`, `secrets/` or `.oriel/`.
- `pnpm --filter @oriel/design-system shots [path…]` takes screenshots in headless Chrome into `shots/` (gitignored), on a server of its own.

## Use it as a builder

You're an agent in an Oriel worktree, about to draw something.

1. `cat packages/design-system/COMPONENTS.md`: one line per component, pattern and screen, with its status and classes.
2. `cat` the page for what you're drawing, such as `guide/components/button.md`. It says when to use it and when not, its states, its keyboard and ARIA rules, its copy, and where the app already uses it, by name: a selector in `window.css`, a component or function in a source file. `pnpm -s ds where <name>` prints the line it's on today. Its ` ```html specimen ` fences are copyable markup with Oriel's real classes.
3. If the page is **drifting**, its "Drift" section says which version to copy until the consolidation lands. If it's **proposed**, it isn't in Oriel yet: don't use it without a story.
4. Live tables (colour tokens, contrast, breakpoints) aren't in the files: `pnpm -s ds foundations/colour` prints a page with them filled in from the checkout. `curl localhost:4400/foundations/colour.md` does the same when the server runs.
5. The words: [Content › Voice](guide/content/voice.md) and Oriel's `SPEC.md` §2. Use the glossary's words exactly.
6. When you've changed the window's CSS or components, run `pnpm ui-check`, and do what each failing line says: document what's new, or list it in `UNDOCUMENTED.md` with a reason.

## Why hand-written specimens, over Oriel's real Preact components

Specimens are hand-written HTML with Oriel's real class names, styled by Oriel's real stylesheet. Rendering the real components with fixture props was the alternative. It was rejected because:

- **It needs a build.** The components are `.tsx` that Oriel compiles with `tsc` into `dist/` (packages/web/dist). The workshop would either run that build in someone else's checkout, which the maintainer's checkout forbids, or depend on a `dist/` that may be stale.
- **It needs the app around it.** Most components read contexts (`ItemLinksContext`, `ChipsContext`, `SendKeyContext`…), dispatch messages into the root model, and import page files. A fixture harness for them is a second app to keep in step.
- **It can't show what isn't one component.** A page often shows four hand-copied versions of one control. A specimen per version shows them side by side; one component can't.
- **The styles are what drifts, and those are live.** The CSS is the part with one source of truth, and the workshop reads it directly. The markup is kept honest by `pnpm check`: every class a specimen uses must exist in Oriel's window.css (or in a marked proposal), every name a page cites must still be in the file it names, and every class a page documents must still exist. When Oriel renames a class, the check fails here.

The cost: a specimen's markup can fall behind a component's. Each page names the component that renders it, so it's one comparison to bring it back.

## How it works

- `src/oriel.ts` finds the checkout, reads `window.css`, and imports Oriel's own `packages/web/themes.ts` and `scripts/check-themes.ts` at run time. The theme list, every token's value, the contrast maths and the "values, not rules" literal check are Oriel's code, not copies.
- **Specimens live in frames.** Each one is its own document with only window.css (and the proposals), so Oriel's global rules never touch the workshop's chrome, and its media and container queries see the frame's width: the 390 view is 390px.
- **Light and dark** are `prefers-color-scheme` in Oriel. The server answers that query one way for a frame (`/oriel/window.css?scheme=dark` swaps the media queries for `all` and `not all`), so the rules stay exactly Oriel's.
- **Forced states.** `/oriel/states.css` copies every window.css rule that has `:hover`, `:focus-visible`, `:focus-within`, `:focus` or `:active`, with only the selector changed to `.ws-hover` and so on. A specimen with `class="button ws-hover"` shows exactly the app's hover. The copy button strips `ws-` classes.
- **The chrome** wears the theme it shows: it reads only window.css's token blocks (`/oriel/tokens.css`), none of its rules.
- **Every view is a URL**: `?theme=broadsheet&scheme=dark&size=large&vp=390`, plus `#<specimen-id>` for a state. `/frame/<page>/<id>?…` is one specimen alone.

## Add a component

1. Write `guide/components/<slug>.md`. Copy [button.md](guide/components/button.md) for the shape. Its front matter:

   ```yaml
   ---
   title: Button
   status: drifting # stable | drifting | proposed
   order: 10 # its place in the index
   classes: button, primary, quiet-action # every class it documents
   summary: One sentence, for the index and search.
   ---
   ```

2. Give it these sections, in order: **What it is**, **When to use it**, **When not to**, **Anatomy and variants**, **States**, **Keyboard and ARIA**, **Content**, **Where the app uses it**, and **Drift** if it's drifting (say which version to copy until it's consolidated). `pnpm check` fails on a missing one.
3. Specimens are fenced HTML:

   ````md
   ```html specimen id=state-hover title="Hover" state=hover
   <button type="button" class="button ws-hover">Mark done</button>
   ```
   ````

   - `id` is a slug, unique on the page; it's the specimen's anchor and frame URL.
   - `state=` labels the state; `side=today` or `side=proposed` puts consecutive specimens side by side.
   - `width=390` draws it at 390px; `height=480` fixes its frame's height (for popovers in the top layer); `screen` draws a 1280 viewport scaled to fit; `bg=surface` sets the frame's background; `pad=0` removes its padding; `nocopy` hides the markup.
   - Force a state with `ws-hover`, `ws-focus-visible`, `ws-focus-within`, `ws-focus` or `ws-active`. Layout helpers: `ws-row` (a wrapping row) and `ws-stack` (a column), and `ws-note` for a caption inside a frame.
   - Show a popover open with `popover="manual" data-ws-open`. Wire a menu with `data-ws-menu="<menu id>"` on its opener. A `.tooltip[popover]` after its control shows on hover and focus. `assets/frame.js` runs these; specimens have no scripts.
   - Use Oriel's copy, from the component's source, and the SYN fixture's names (SYN-23, Checkout v2…), not lorem ipsum.

4. Cite Oriel by name, never by line, so a line added above doesn't make the page wrong. Write the name, then `in`, then the file, each as a code span:

   - a CSS rule by one of its selectors, as written: `` `.connect-actions` in `window.css` ``, `` `.quiet-action:hover:not(:disabled)` in `window.css` ``; an at-rule, `` `@keyframes pulse` ``, or a token, `` `--accent` ``;
   - code by a top-level declaration: `` `FolderStep` in `packages/web/src/connect-steps.tsx` ``;
   - several in one file: `` `.button`, `.button.primary` and `.button.danger` in `window.css` ``;
   - a rule written more than once, with a count the check holds it to: `` `.connection-problem` twice in `window.css` ``.

   A file on its own, `` `packages/web/src/menu.tsx` ``, is fine too. Each name links to the source viewer at the line it's on today. The check fails if a name isn't in its file, if the count is wrong, or if a page cites a `file:line`. `pnpm -s ds where <name> [file]` prints where a name is, with its line.

5. A proposal's CSS goes in `assets/proposals/<name>.css`, beginning with a `PROPOSAL` comment. It may use only Oriel's tokens (the check runs Oriel's own literal rule over it), may not reuse a class window.css has, and must scope every rule to a class.
6. If what you documented is listed in [UNDOCUMENTED.md](UNDOCUMENTED.md), take its line off: the check fails on a line whose names are on a page.
7. Run `pnpm --filter @oriel/design-system index` (it rewrites `COMPONENTS.md`) and `pnpm check`.

A page in `guide/patterns/`, `guide/foundations/`, `guide/content/` or `guide/screens/` is the same, with fewer required sections. A screen is built only from classes some component documents, and none that only a proposal has. A ` ```live <table> ` fence fills in a live table: `colour`, `contrast`, `tokens <type|space|shape|elevation|motion|layout|derived>`, `breakpoints`, `themecheck`, `icons`, `motion` and `reduced-motion`.

## The checks

Oriel's `pnpm check` runs those that need no browser, about 1.5s, after this package's `tsc` and the repo's `oxlint --deny-warnings` and `oxfmt --check`. `pnpm ui-check` runs every check, the three in headless Chrome too, for a builder who has touched the window. It judges the checkout it's in, or the one `ORIEL=<path>` names, and writes nothing to it. Each problem is one line saying what to do, such as "`.noticed-card` in window.css isn't documented: add it to a page, or to UNDOCUMENTED.md with a reason". Name checks to run only those: `pnpm ui-check accessibility`.

Oriel's, in `pnpm check` and `pnpm ui-check`:

- **classes**: every documented and used class exists in window.css or a proposal; screens use only documented, non-proposed classes.
- **coverage**, the other way: every class window.css styles and every component packages/web/src exports is on a guide page (in a specimen, a page's `classes`, or a code span naming it), or listed with a reason in [UNDOCUMENTED.md](UNDOCUMENTED.md). A new surface in Oriel fails here until someone documents it or lists it, and a listed name fails once a page covers it or Oriel drops it. That list is the next round's to-do.
- **proposals**: no class collides with window.css's; no literal colour, size, weight, radius, border width, shadow or duration (Oriel's own rule); every rule scoped to a class.
- **references**: every name a page cites is in its file today (as many times as it says), every file it names exists, and no page cites a line.
- **contrast**: every claimed token pair, in every theme and scheme, by Oriel's own contrast code: text 4.5:1, the focus ring and the accent 3:1 against every background, and Oriel's own theme check.
- **accessibility**, in headless Chrome, in `pnpm ui-check` only: in every specimen, in Graphite light and Broadsheet dark, every button, link, field, checkbox, radio, switch and menu item has an accessible name, and every tab stop draws a visible focus. Problems are grouped by element: one missing `:focus-visible` rule is one line, with how many places it shows.

The workshop's own:

- **guide**: required sections, statuses, specimen ids.
- **index**: `COMPONENTS.md` is current.
- **links**, in headless Chrome, in `pnpm ui-check` only: every internal link and `#anchor` on every page resolves.
- **chrome**, in headless Chrome, in `pnpm ui-check` only: the workshop's own pages give every control a name and a visible focus.

Each check prints how long it took. The checks before the browser take about 1.5s together, `links` about 8s, and `accessibility` 25 to 40s: it loads 406 specimens in two themes, four tabs at a time (`CHECK_TABS` sets how many). `node packages/design-system/scripts/check.ts references` runs only the checks it names.

## Not yet

Components Oriel doesn't use, left out on purpose: a modal dialog beyond the one confirm, toasts that aren't the bead, date and time pickers, a combobox or autocomplete, pagination controls (Browse pages in place with "Show N more"), breadcrumbs, avatars beyond an assignee's initials, a data grid (a block's table is read-only), file upload (drops go through the window's drop zone), a stepper beyond the first run's column, and a tree view (Browse's clusters are one level deep).
