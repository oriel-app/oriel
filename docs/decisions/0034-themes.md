# 0034 Themes are sets of values over one stylesheet

Accepted 2026-11-02 (OA-112). Amends 0033. Changes SPEC §2.

Adds: none

**Decision.**

- **Themes are values, not rules.** `window.css` has one set of rules. For colour, type, space, radius, borders, elevation and motion they read only custom properties.
  - A **theme** is a named block of values for those properties, light and dark, applied by `data-theme` on the root element. The default theme is `:root` itself, and every other theme is `:root[data-theme="<name>"]`, with its dark values under `prefers-color-scheme`, as today. Light or dark stays the system's choice.
  - Shared tokens, and `color-scheme`, sit in their own blocks on `html`, its narrow-screen ones included, so every `:root` block is a theme's.
  - A theme sets only theme tokens (below). Every theme sets all the colour ones, in both schemes. A token the default gives a value per scheme, such as a shadow, a theme sets in both or in neither, since `:root[data-theme]` outranks the default's dark block. Anything else it leaves to the default. No rule outside a theme block selects on `data-theme`.
  - Picking a theme never loads another stylesheet or a font file. Fonts are system stacks only, and the serif is `Charter, "Iowan Old Style", Cambria, Georgia, serif`. No dependency is added.
  - Spacing is the one category with literals left in rules. A theme changes density through the space scale, `--row` and `--row-pad`, which is all 3B's density took. A fixed width, an icon's size or a nudge under `--space-1` stays in its rule, where no theme needs to reach it.
- **One token set: today's names, with these changes.**
  - Renamed, each for a reason:
    - `--accent-text` becomes `--on-accent`, as in 1A. Elsewhere `-text` means a colour used as text (`--done-text` is done, written), and this one is text on a fill: the accent, and the swipe actions' done and danger. The count badge that writes `--bg` on the accent uses it too.
    - `--duration-panel` becomes `--duration-move`. Every move goes at one speed, though today the panel and the window chat read the token, and the sidebar's fold, the swipe row and the drawer hard-code 180ms or 200ms.
  - Each state is one colour, used for its text and its mark. `--todo-text`, `--in-progress-text` and `--done-text` go. `--handed-off-text` and `--handed-off-soft` leave the theme: handed off is drawn as done, in every theme. Every `-soft` is mixed from its colour by the theme's `--tint`, as 1A does.
  - The accent means "your move": Needs you, a change set to review, Approve. There's no separate needs-you colour.
  - Added, from both critiques and the two branches' diffs:
    - colour: `--tint`, how strongly a `-soft` is mixed;
    - type: `--font-heading` and `--title-weight` for the thread, panel and page titles; `--weight-regular`, `--weight-medium` and `--weight-strong`; `--leading-tight`, `--leading` and `--leading-prose`;
    - the overview's section heads: `--section-rule` (a border, or none), `--section-head-font` (a `font` shorthand: weight, size, family), `--section-head-case` and `--section-head-tracking`;
    - the overview's lists: `--list-frame` (a border, or none), `--list-bg`, and `--row-pad` for a row's block padding;
    - the ask bar: `--ask-mark`, a border on its start edge, or none;
    - borders and elevation: `--border-thin`, `--border-thick` and `--shadow-sm` beside `--shadow`;
    - motion: `--duration-quick` beside `--duration-move` and `--ease-out`.
  - Removed:
    - `--radius-xl`, and the 999px pills. 1A had neither, so square corners are three radius tokens: `--radius-sm`, `--radius` and `--radius-lg`. A dot stays round.
    - `--chip-icon` and `--chip-underline`, the chip's last two. #126 drew the chip with no box, as 0032 says, and dropped the rest. A chip reads the text, line and state tokens, like any rule.
  - Shared, never a theme's: layout (`--page`, `--rail`, `--chat`, `--sidebar`, `--panel`, `--beside`, `--bar-height`, `--inset-top`, `--head-row`, `--slide-panel`), and what's derived from theme tokens: every `-soft`, `--focus` (the accent), `--ins` and `--handed-off` (done), `--derived-line`, `--sidebar-bg`, and the scrim.
  - The section head's colour stays `--text-muted` in every theme. The rule above it gives the sections their rank.
- **What every theme must pass.** A repo check in `pnpm check` reads `window.css` and fails on any theme, in light or dark, where:
  - **Contrast.** A text token (`--text`, `--text-muted`, `--text-faint`, the accent, each state, `--derived`, `--del`) on any background (`--bg`, `--surface`, `--surface-hover`, `--surface-sunk`, `--list-bg`) is under 4.5:1. The same goes for a state or `--derived` on its own `-soft`, and `--on-accent` on the accent, `--done` and `--danger`. That is WCAG AA. The check evaluates `color-mix()` as the browser does.
  - **The states a PM scans for stay apart.** These five colours are the accent (your move), `--in-progress`, `--danger` (an error, or an item stalled: in progress with no update in 14 days), `--done`, and `--derived` (an Oriel rule). Any two of them must differ by at least 10 in CIEDE2000. Under protanopia, deuteranopia and tritanopia, each simulated at full strength (Machado 2009), they must differ by at least 4.
    - A stalled apply waits on the user (Try again, Dismiss), so it stays in the accent, as today.
    - Handed off isn't in the five. It is a way of being finished, so it is shared and drawn as done.
    - The method is pinned, because Graphite clears the floor by 0.2: Machado's matrices applied in linear sRGB, then CIELAB under D65, then CIEDE2000 with kL = kC = kH = 1. That is the spike's calculation, and the check reproduces its numbers.
  - **Values, not rules.** A theme block sets a shared token or a property that isn't a token. A rule outside a theme selects on `data-theme`. A rule has a literal colour, font family, weight, font size, radius (but a dot's 50%), border width, shadow or transition duration. `transparent`, `currentColor`, `inherit` and `none` aren't literals, and a ring (a shadow with no blur, in a token's colour) is a border, not elevation.
- **Shared behaviour, never a theme option.**
  - Below 760px, workstream names and the overview's titles wrap instead of truncating. Chips already wrap with their sentence (#126) and keep doing so.
  - The working dot pulses, an applying change set dims, and a disabled control looks disabled. 3B removed all three, a regression, not a choice. Their opacities and the pulse stay literal in their rules: they aren't tokens, so no theme can reach them.
  - `prefers-reduced-motion` is handled once, in one block that stills every move and the pulse, and keeps the panel's fade. The four blocks today, and the two `pulse` keyframes, become one of each.
- **The default theme is Graphite.** It is 1A: warm greys, one indigo accent, hairlines, compact rows. To that it adds three things from 3B. The serif `--font-heading` sets the thread, panel and page titles, and rows stay sans. A thin rule sits above the overview's section heads. Names and titles wrap, as above.
- **The second theme is Broadsheet.** It is 3B: cream, serif section heads under a heavy rule, square corners, open lists, a marked ask bar. It gets a new palette that passes the check.
  - Both spike directions were called "Ledger", and a ledger is what both look like, rows and rules. Each new name says in one word what sets its theme apart. Graphite is grey and dense, the look of a pencil. Broadsheet is a newspaper page, with paper, serif heads and ruled sections.
- **How a theme reaches a sketch.** 0033's theme sheet sets the neutral tokens with the values of the person's theme, light and dark.
  - The sheet holds `--bg`, `--surface`, `--surface-hover`, `--surface-sunk`, `--line`, `--line-strong`, `--text`, `--text-muted`, `--text-faint`, the three fonts, the text sizes, weights and leadings, the space scale and the radii. It never holds the accent, a state, `--del`, or a section, list or ask-bar token.
  - The sketch route still takes only ULIDs. The server reads the stored theme, as it does for the page, and builds the sheet from `window.css`'s own theme blocks, so the frame can't drift from the page. A frame takes a new theme the next time it is served. 0033's isolation is unchanged.
- **Where the choice lives.** A theme is a per-person preference, picked on the settings page.
  - Oriel's server writes `data-theme` into the page shell's `<html>`, from the stored preference, so the first paint is right with no script. Oriel's CSP allows no inline script but the import map.
  - Picking a theme sets the attribute at once, with no reload. A review link's page always uses the default theme, since its reader isn't the person who picked.
  - How the preference is stored is the settings story's.

**Why.**

- Three designers each proposed a conservative and a bold identity. The maintainer liked 1A and 3B and wants to choose between them, so both must exist at once, over one product.
- In 3B the look rode along with the rules. Its stylesheet removed the pulse, the applying dim and the disabled look while it changed colours, and nothing caught it. Two stylesheets would drift like that on every change. With one set of rules, a fix lands in every theme, and a theme can't remove behaviour, because behaviour isn't a value.
- Both critics would ship 1A first. D1: 3B's best ideas carry over, and none of its colours. D3: 1A's separation of attention, progress and stalls is the stronger base for an 8-hour day. Graphite takes what each critic would steal from the other: 1A's states, density and coloured word diffs, and 3B's serif titles, section rules and wrapping.
- Both critics named the same missing tokens. D3 named four more: a section head's size (in `--section-head-font`), the rule's inset (shared), wrapping (shared behaviour) and separate tokens for the questions to start from (#126 made them buttons). With those added, both directions are pure value sets.
- Contrast, measured on the spike's own values. 1A passes all 59 pairs in each scheme, `--list-bg` (its surface) and `--on-accent` on done and danger included: at worst 4.58:1 light (`--text-faint` on `--surface-hover`) and 5.28:1 dark (`--danger` on its `-soft`). Today's main fails: `--text-faint` is 3.0 to 3.3:1 on its light backgrounds.
- The thresholds for telling the states apart come from the spike:
  - CIEDE2000 sees about 2.3 as just noticeable side by side. A 7px dot read at a glance needs several times that.
  - 1A's closest pair is the accent against in progress: 13.9 dark, 17.9 light, and 4.2 under simulated deuteranopia (dark). Its next closest under simulation is in progress against done under tritanopia, 5.9.
  - 3B fails outright. `--accent` and `--in-progress` are both `#77520a`, a difference of 0. Its needs-you `#764c16` is 4.3 from both (light), and 1.8 under tritanopia. That's the one brown D1 saw on your turn, Needs review, an Oriel rule and the in-progress bar.
  - Today's main fails too. Its accent and in progress are two blues, 3.8 apart (light), and 2.6 under tritanopia.
  - 10 sits between every failing pair measured (5.3 at most) and 1A's closest. 4 under simulation is the floor 1A clears, above where 3B's pairs merged (0 to 3.4). A theme that fails is unreadable to someone scanning 40 workstreams, and to colour-blind users first.
- The accent as "your move" is 1A's idea, and it is why 1A reads: one colour means "act here". A second near-accent colour for needs-you is how 3B ended up with three browns.
- The server writes the attribute because the alternatives flash or need an exception. A preference read by a script runs after the first paint, or needs an inline script the CSP would have to hash. The sketch route has to know the theme too, and only the server knows it there.
- System serif stacks give Charter on macOS, Cambria on Windows and Georgia almost everywhere. A web font is a file to load, a dependency and a CSP change, for a title.

**Rejected.**

- **A stylesheet per theme.** It's how 3B was built, and how it lost the pulse and the disabled look. Every surface would need checking once per theme.
- **Primitives (`--n0` to `--n7`) as the shared contract.** Both spikes used them, but each mapped them onto the names differently: 3B's muted and faint text are one grey, 1A's are two. The names the rules read are the contract.
- **A needs-you colour beside the accent.** See above.
- **Theme tokens for wrapping, the pulse, dims and reduced motion.** They are behaviour. A token is a door for a theme to turn them off, as 3B did.
- **Web fonts.** A file per theme, a dependency, and a flash.
- **The preference in the browser only.** No flash-free first paint without an inline script, and the sketch route couldn't follow it.
- **Keeping "Ledger".** It names both.

**Consequences.**

- Amended here, not edited: 0033's theme sheet holds the neutral tokens listed above, with the values of the person's theme. Its "which tokens follow OA-112" is settled here.
- SPEC §2 gains "theme".
- Three stories in OA-112, one after another:
  - **Themes over one token set, Graphite the default.** `window.css` reads only tokens, with the renames, additions and removals above. The shared behaviour lands as above, and the sketch sheet's token list is fixed. The repo check joins `pnpm check`. Main fails its contrast and states rules today, and Graphite passes them, so the check lands green. Before and after screenshots of every surface, light and dark, at 1280 and 390.
  - **A settings page, with Theme and Title model.** It stores the preference and writes `data-theme` into the shell. Telemetry gains a theme picked, by name.
  - **Broadsheet,** with a new palette that passes the check.
- A new theme later is one block of values and a name in the picker. No rule changes, and the check judges it.
- SPEC §14's "design system" stays not now. That is a component library shared beyond the window. Themes are values over the one stylesheet Oriel already has.
