# 0005 Own canvas

Accepted 2026-10-28.

**Decision.** The phase 2 canvas is built in `packages/canvas`, not taken from a library.

**Why.** Dependency policy (0008). The canvas is the product's surface, and agents maintain it around the clock, so we need code they can fully read.

**Consequences.** Budget the hard parts explicitly: inline text editing, undo across zoom levels, HiDPI rendering, and pointer/trackpad/touch gestures. Libraries earn their keep there. Nothing starts until phase 1 passes the kill criteria in SPEC §13.
