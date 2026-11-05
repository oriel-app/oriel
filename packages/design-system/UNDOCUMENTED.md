# Undocumented

What of Oriel no guide page covers yet, each with why. `pnpm check` holds the guide to it: every class window.css styles, and every component packages/web/src exports, is either on a guide page (in a specimen, in a page's `classes`, or named in a code span) or listed here. A new surface fails the check until someone documents it or lists it on purpose, and a line here fails once its names are on a page or gone from Oriel. So this page is the next round's to-do: take a line off by documenting what it names.

A line is a name or names, then a colon and the reason. `.chart-*` is a family: `.chart` and every `.chart-…` class.

## New since the survey

The guide was written against Oriel `5ee7a339`. These landed after it.

### Chart blocks

- `.chart-*`, `.timeline-*` and `.pivot-*`: a block's series with Oriel's forecast, its timeline, its spread and its pivot (from `history()`). The Block page documents bars, table, preview and rows, not these four forms.
- `SeriesChart`, `TimelineChart`, `SpreadChart` and `PivotChart` in `packages/web/src/charts.tsx`: the same four forms.

### Noticed (decision 0052)

- `.noticed-*`: the overview's Noticed strip, what Oriel finds in the window unasked: its cards, kinds, why lines, rule marks and actions. Pins, which came with it, are on the Block page.
- `NoticedStrip` in `packages/web/src/noticed-strip.tsx`: the strip.

### A second look at a change set (decision 0054)

- `.second-look-*`, `.finding-*` and `.suggested-*`: a second look, when the person asks for one: its head, its findings and what it suggests adding. The Change set page predates it.
- `SecondLook` in `packages/web/src/second-look.tsx`: the same.

## Missed in the first survey

These were in Oriel at `5ee7a339`, and no page covered them.

### The first run

- `.setup-*`: the first run's page: its brand, its two steps, its command and terminal boxes, its links and foot. Its buttons and provider rows are on the Button and Connection row pages; the page as a whole needs a screen.
- `.cli-training`: the line under a CLI row that says the person's plan may let its vendor train on their chats. It belongs on the Connection row page, with the CLI rows.

### Browse

- `.window-layout`, `.window`, `.counts`, `.fixture` and `.adding`: Browse's frame, its count line with the fixture tag, and the "Pick items to add to…" note. Its rows, filters and tabs are on their own pages; Browse as a whole needs a screen.

### Connecting from the window

- `.connect-card`, `.connected-dot` and `.connected-empty`: the window's card for each connector it may connect, and the note when a connection read nothing. The Connect steps pattern covers the steps, not the cards.
- `ConnectCards` and `ConnectNotices` in `packages/web/src/connect-steps.tsx`: the same.
- `Inline` in `packages/web/src/connect-steps.tsx`: a connector's help text with its links, reviewed code; a renderer, with no look of its own.

### Settings

- `.provider-key-actions`, `.provider-key-note` and `.provider-path-open`: a key's actions and note, and Open beside a CLI's path. The Connection row page covers the rows, not these.

### The window chat

- `.window-chat-head` and `.window-chat-title`: the window chat's head, "Ask about your window". The Message page covers the panel and its close, not its head.

### Building blocks with no look of their own

- `Link` in `packages/web/src/parts.tsx`: an in-app link with a real href; it draws whatever it wraps.
- `Replies` in `packages/web/src/parts.tsx`: a message's replies, as a link to it, inside a block.
- `ProseBlocks` and `Inlines` in `packages/web/src/parts.tsx`: renderers for text a source has already read, such as rich text and mentions; what they draw is on the Message and Item panel pages.
- `DropZone` in `packages/web/src/parts.tsx`: the window's drop zone and its veil, for a dragged link, key or file. It wants a pattern page.

### Held for the bead

The bead (decision 0056) merged as `f3524d07`. Its pages wait for the maintainer's review of it, with the Undo page.

- `.bead-*`: the bead, the Undo notes at the top of the window that replaced the stack at its foot: its layers and rows, its marks, its actions and its count.
- `BeadStatus` in `packages/web/src/undo-stack.tsx`: the bead's one status region and alert, on every page but a review link's.
- `WindowUndos` in `packages/web/src/end-workstream.tsx`: the window's Undo notes, which the bead now draws.

## Gone from Oriel, still on pages

The bead removed these classes. The pages that still cite them (the Undo page, and the Undo parts of Button, Destructive actions, Space and the "more" lab) are held for the maintainer's review of the bead, so the class and reference checks let these names through, and only these. A line here fails once a class is back in window.css or no page cites it.

- `.undos`, `.undo`, `.undo-note` and `.closing-problem`: the stack of Undo notes at the window's foot and its closing problem, which the bead replaced.
