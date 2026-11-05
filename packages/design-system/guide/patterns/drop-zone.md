---
title: Drop to add
order: 60
summary: Dragging a card, a link, an item's key or a file onto a workstream or one of its threads adds it to the workstream; a veil over the page says where the drop goes.
---

# Drop to add

## The problem

A person reading Jira, Slack or a folder in another window sees something that belongs in a workstream. Finding it again in Browse, picking it and choosing the workstream is four steps for one thing they're already looking at. A drop does it in one, but a page that takes drops anywhere has to say, while the drag is over it, that it will take this one and where it goes.

## The pattern

A workstream's page and a thread's page are each one drop zone, for the workstream they belong to. Only drags from outside Oriel count: "one that starts in this page, like text moved into the composer, is left to the browser" (`DropZone` in `packages/web/src/parts.tsx`). A drag counts if it carries files, a link or text.

While such a drag is over the page, a veil covers the page column, never the sidebar or the item panel, and says where the drop goes. The veil takes the drop, so leaving the veil is leaving the zone.

```html specimen id=veil title="Dragging a link over a workstream's page" height=220
<div class="drop-page">
  <div class="drop-veil">
    <p>Drop to add to Checkout v2: phone wallets and saved cards</p>
  </div>
</div>
```

- `.drop-veil` is fixed over the page column, `0.5rem` in from its edges and below the bar: a `--border-thick` dashed `--accent` border, `--radius-lg`, on `--accent-soft` at 85%. It sits at layer 20, with the drawer's scrim ([Space](/foundations/space)).
- Its line is one sentence on `--surface`, `--text-lg` at `--weight-strong`, in `--accent`: "Drop to add to {workstream}".
- On a workstream the zone is `.drop-page`, at least the window's height under the bar, so a short page still takes a drop anywhere below its last row. On a thread, the zone is the thread's own layout.

What was dropped goes to the server as links and files by name and time, never a path: a browser gives a page nothing more (`readDrop` in `packages/web/src/drop.ts`). The server finds the items they name and adds them. The page shows the new rows; what it couldn't add is one sentence in the page's notice line:

- "Couldn't add “{what}”: {why}" and "{N} more couldn't be added either." (`dropNotice` in `packages/web/src/drop.ts`);
- "That's already in this workstream.";
- "Nothing that was dropped names an item. Drop an item, or a link to one."

## Do

- Name the workstream in the veil, exactly. The person is choosing where it goes by where they let go.
- Keep the veil to the page column, so the sidebar and the item panel stay what they are.
- Add what can be added and say what couldn't, in one sentence, with the first reason.

## Don't

- Don't take a drag that started in the page. Text moved inside the composer is the browser's.
- Don't make a second drop zone inside a page. One page, one workstream.
- Don't ask before adding. A drop is the person's own act, and the row it makes can be removed.

## Where Oriel does it

- The zone and its veil: `DropZone` in `packages/web/src/parts.tsx`; what a drag carries, `carries` in `packages/web/src/drop.ts`.
- On a workstream's page: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`. On a thread's page: `ThreadPage` in `packages/web/src/thread-page.tsx`.
- What a drop did, in words: `dropNotice` in `packages/web/src/drop.ts`.
- CSS: `.drop-page`, `.drop-veil` and `.drop-veil p` in `window.css`.

### Drift

- **The veil's line uses raw values.** `.drop-veil p` pads `0.5rem 1rem` and the veil sits `0.5rem` in, not on `--space-*` tokens ([Drift report](/drift), D15).
