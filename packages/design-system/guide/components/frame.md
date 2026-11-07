---
title: The frame
status: stable
group: Layout
order: 59
classes: shell, shell-main, frame, sidebar, sidebar-head, brand, bar, bar-menu, page, page-title, setup-page, setup-brand, icon
summary: The window's one material: the sidebar, a band along the page column's top and one down its right, with the column set into it, its top corners curved. The bead grows from it.
---

# The frame

## What it is

The frame (decision 0056, amended) is one material: the sidebar, a 4px band along the top of the page column, and a 4px band down its right, all `--frame`. The page column is set into it, on `--bg`. Where the band meets the sidebar, the column's corner takes a long, gentle curve, "like a table's apron running into its leg" (`--frame-corner`, 26px in Graphite), and its top-right corner the same. The frame casts a slight shadow onto the column (`--frame-shadow`), so the page looks just inset.

It's CSS, but for [the bead](/components/bead), which is the frame's material growing from the band:

- **The shell** (`.shell` in `window.css`) is `--frame`, the page's whole height, so a long page never shows a gap beside the sidebar. The sidebar is the same colour, with no line between them.
- **The column** (`.shell-main` in `window.css`) is `--bg`, `--frame-band` in from the right, past the panel when it sits beside the page.
- **The band and the corners** (`.frame` in `window.css`) are one fixed box as wide as the column, its top corners rounded, with the frame's colour reaching out from it (`--frame-reach`) and cut to the column's top. It stays as the page scrolls under it, and takes no pointer. Its layer is `--layer-frame`: over the page and its sticky parts, under the sidebar's drawer, the panel, the window chat and the bead.

```html specimen id=wide title="Wide: the sidebar, the band and the curve where they meet" height=200 pad=0
<div class="shell" style="--sidebar: 12rem; min-height: 0; height: 100vh">
  <aside class="sidebar" style="height: 100vh">
    <div class="sidebar-head"><a class="brand" href="/">Oriel</a></div>
  </aside>
  <div class="shell-main">
    <div class="page"><h1 class="page-title">Settings</h1></div>
  </div>
  <div class="frame"></div>
</div>
```

### Folded

With the sidebar folded to icons (`.shell[data-folded]`), the curve follows the column's left edge, and moves with it as it folds.

```html specimen id=folded title="Folded: the curve follows the column" height=200 pad=0
<div class="shell" data-folded style="min-height: 0; height: 100vh">
  <aside class="sidebar" style="height: 100vh">
    <div class="sidebar-head"><a class="brand" href="/" aria-label="Oriel">O</a></div>
  </aside>
  <div class="shell-main">
    <div class="page"><h1 class="page-title">Settings</h1></div>
  </div>
  <div class="frame"></div>
</div>
```

### Narrow (760px and under)

The sidebar is a drawer, so the bar is the frame: `--frame`, with no line under it. The column's top corners curve from the bar's lower edge, tighter (`--frame-corner-narrow`, 18px in Graphite), there are no bands beside the page, and the bead grows from the bar.

```html specimen id=narrow title="Narrow: the bar is the frame" width=390 height=200 pad=0
<div class="shell" style="min-height: 0; height: 100vh">
  <div class="shell-main">
    <header class="bar">
      <button type="button" class="bar-menu" aria-label="Open the sidebar">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
      </button>
      <a class="brand" href="/">Oriel</a>
    </header>
    <div class="page"><h1 class="page-title">Settings</h1></div>
  </div>
  <div class="frame"></div>
</div>
```

### The first run

The first run has no sidebar, so it's framed as a narrow screen is, at any width: its brand's row (`.setup-brand`) is the frame, and the column curves from it (`.setup-page` in `window.css`).

```html specimen id=first-run title="The first run: its brand's row is the frame" height=160 pad=0
<div class="setup-page">
  <header class="setup-brand">Oriel</header>
  <div class="frame"></div>
</div>
```

## When to use it

- Once in the shell (`App` in `packages/web/src/app.tsx`), and once on the first run (`SetupPage` in `packages/web/src/setup-page.tsx`), as `<div class="frame" aria-hidden="true">`. Every page in the column is framed by it: the overview, Browse, a workstream, a thread, the Done page, Settings.
- Start a page's first line `--inset-top` down, as every page does. In the column that's `--frame-room`: the band, the bead's resting height and `--space-4`, so a resting bead covers no page head.

## When not to

- Not on a review link's page, which stands alone.
- Not drawn by script: only the bead is. Don't redraw a whole-window shape each frame.
- Not a border or a hairline. The frame's edge is its colour and its shadow; don't add a line between the sidebar and the column, or under the bar.

## Anatomy and variants

- **Colour:** `--frame`, set by each theme in light and dark. In light it's a little deeper than the page; in the dark, a little lighter. `--sidebar-bg` is `--frame`.
- **The band:** `--frame-band`, 4px, and 0 on a narrow screen. `--frame-top` is where the band's lower edge is: `--bar-height` and the band.
- **The corner:** `--frame-corner` on a wide screen and `--frame-corner-narrow` on a narrow one, set by each theme: Graphite's 26px and 18px, Broadsheet's tighter 12px and 8px. `--frame-curve` is the one in use.
- **The shadow:** `--frame-shadow`, an inset shadow along the column's top, in `--frame-shade`, which each theme sets in light and dark: the dark's is much stronger, so it reads on the deeper page. The bead casts the same shade.

```live
tokens frame
```

## States

- **Rest:** still. The frame never moves, but for its left edge as the sidebar folds, at `--duration-move`.
- **Reduced motion:** the fold's move is instant.
- Hover, focus, active, busy, disabled and error: none. The frame is never a control.

## Keyboard and ARIA

- The frame is `aria-hidden` and takes no pointer, so nothing reaches it and it hides nothing a person can use.
- The bar, in the frame on a narrow screen, keeps its menu button, named for what waits: see [Sidebar](/components/sidebar#narrow-screens-the-bar-and-the-drawer-760px-and-under).

## Content

None of its own. The sidebar, the bar and the bead write on it, in the page's text and state colours, each 4.5:1 or more on `--frame` (Oriel's theme check holds them to it).

## Where the app uses it

- `App` in `packages/web/src/app.tsx` and `SetupPage` in `packages/web/src/setup-page.tsx`.
- CSS: `.shell`, `.shell-main`, `.frame`, `.bar` and `.setup-page` in `window.css`. Tokens: `--frame`, `--frame-shade`, `--frame-corner` and `--frame-corner-narrow` in each theme; `--frame-band`, `--frame-curve`, `--frame-top`, `--frame-shadow`, `--frame-reach`, `--frame-room` and `--layer-frame` on `html`.
- The bead that grows from it: [The bead](/components/bead).
