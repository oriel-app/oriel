---
title: Counts
order: 80
summary: What window.css still writes by hand where a token or one shared rule could hold it, counted from today's file.
---

# Counts

Oriel's theme check holds colours, font sizes, weights, radii, border widths, shadows and durations to tokens (decision 0034). Spacing literals are allowed, so copies of one control come apart there: not as literals, mostly, but as different choices of token (`--radius` against `--radius-sm`, `--text-muted` against `--text-faint`, `--text-sm` against `--text-md`). This table counts what can be counted, read from `window.css` each time the page opens.

```live
census
```
