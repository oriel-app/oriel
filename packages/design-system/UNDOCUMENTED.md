# Undocumented

What of Oriel no guide page covers yet, each with why. `pnpm check` holds the guide to it: every class window.css styles, and every component packages/web/src exports, is either on a guide page (in a specimen, in a page's `classes`, or named in a code span) or listed here. A new surface fails the check until someone documents it or lists it on purpose, and a line here fails once its names are on a page or gone from Oriel. So this page is the next round's to-do: take a line off by documenting what it names.

A line is a name or names, then a colon and the reason. `.chart-*` is a family: `.chart` and every `.chart-…` class.

## Listed now

At Oriel `85a125e9` every other class window.css styles and every component packages/web/src exports is on a guide page (OA-256 documented the last round's list).

### A connection's mapping in Settings (OA-232)

- `.connection-mapping`, `.mapping-*`, `.review-controls`, `.review-fields`, `.review-field`, `.review-name` and `.connect-said`: how a Sheets connection reads each tab, in a line a tab with Ask Oriel and Edit by hand; the review step's editor on one tab; and what applying a mapping does, said before Apply. The Settings and Block pages predate them, and the drift report's one Field (D11) may take the editor's fields.
- `.folded-*`: a long list folded into one line, which opens to its first few with a search, such as the tabs a connection doesn't read.
- `Folded` in `packages/web/src/parts.tsx`: the same.

A gone class, one Oriel dropped that a page held for a review still cites, goes under a "Gone from Oriel" heading of its own, and only until that page is reviewed.
