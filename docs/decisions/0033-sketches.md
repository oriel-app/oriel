# 0033 The agent can sketch in HTML, in a frame that reaches nothing

Accepted 2026-11-02. Amends 0030 and 0032. Changes SPEC §2. Built after the visual identity (OA-112).

Adds: none

**Decision.**

- **A sketch** is a document of HTML and CSS, inline SVG included, that the agent writes and Oriel shows in a sandboxed frame under its answer. It has no scripts and no links, and Oriel never treats anything in it as its own.
- **What the agent may write.** Every `<name` and `</name` in the text, wherever it sits (in a comment, a `<style>` or an attribute too), must name an allowed element, in any case. The list holds elements for text, lists, tables, sections, form controls outside a form, `img`, `details`, and SVG's shapes, text, gradients, markers and `use`. It holds nothing that can navigate, hold a frame, run anything or load media: no `a`, `area`, `iframe`, `frame`, `object`, `embed`, `form`, `link`, `meta`, `base`, `script`, `noscript`, `template`, `picture`, `video`, `audio`, `image`, `feImage` or `foreignObject`. A `<` in text is written `&lt;`. The building story writes the exact list.
  - Every `href`, `xlink:href` included and in any case, is written `href="#name"`, pointing inside the sketch. The same scan checks it.
  - The check refuses; it never rewrites. A refusal tells the agent which names to change, in a tool result, and nothing is shown, as for a block (0030).
  - It runs when the agent calls `sketch()`, and again whenever the frame is served, so a stored sketch meets today's list. The host refuses a height outside the three below. The route takes only ULIDs, and builds the outer document from constants and the checked text alone.
  - The scan doesn't parse. A browser makes an element only from such a token, or implies one (`html`, `head`, `body`, `tbody`, `tr`), so nothing it builds can be missing from the scan. A stray `<` is refused, never missed. An `img` is drawn as a still image, which never loads or navigates, so among allowed elements only `href` could bring in a document with a link, and the `href` rule keeps it inside.
- **Isolation: two frames, and no tokens.**
  - Oriel's page holds `<iframe sandbox>`, with no tokens at all, of a document from the **sketch origin**. That is a second listener of Oriel's server, on its own loopback port. It serves only `GET /sketches/<thread>/<sketch>`, behind the same Host check as Oriel's other routes (`guard.ts`). Oriel's CSP gains `frame-src` for that origin only, and the review link's page doesn't gain it.
  - That outer document is Oriel's, with no script: one `<iframe sandbox srcdoc="…">`, again with no tokens, holding Oriel's theme sheet and then the agent's text, with `&` and `"` escaped. A `srcdoc` document takes its parent's CSP, so the agent's document lives under the outer document's policy, set by a header the agent can't touch.
  - The outer document's headers are Oriel's usual ones (`no-store`, `nosniff`, `no-referrer`) and this CSP:
    - `default-src 'none'`: no fetch of any kind, and, as `frame-src`, no navigation of the inner frame.
    - `style-src 'unsafe-inline'`: the agent's `<style>` and `style=`, with no URL that can load.
    - `img-src data:`: images written inline, and nothing fetched.
    - `base-uri 'none'` and `form-action 'none'`: a second wall behind the check.
    - `frame-ancestors` Oriel's origin: only Oriel frames a sketch.
    - `sandbox`: the document is sandboxed even when its address is opened on its own.
  - No sandbox token is given, at either level:
    - `allow-scripts`: a script can still open WebRTC.
    - `allow-same-origin`: it would give the document an origin to act as.
    - `allow-forms` and `allow-popups`.
    - `allow-top-navigation` and its by-user-activation form.
    - `allow-downloads` and `allow-modals`.
- **Height: three fixed sizes.** The agent picks 240, 400 or 640 pixels, and a sketch taller than its frame scrolls inside it. The width is the answer's. A frame across origins can't be measured from outside without a script inside, so there's no measuring.
- **Spoofing.** Synced content can steer the agent into drawing a fake Approve, a fake chip or a fake Oriel note.
  - Oriel draws the frame's border and its caption outside the iframe, in its own UI: "Sketched by the agent · not checked against Oriel's data".
  - Nothing inside does anything. With no links, forms or scripts, a button in a sketch is a picture of a button.
  - Approve, Revert and every other control stay in Oriel's UI, outside any sketch.
  - Nothing inside a sketch is ever trusted as Oriel's: not a status, a chip, a number or an instruction. `[[id]]` in a sketch is text.
- **Data in a sketch.** Oriel can't check that a sketch's numbers or names came from a read, and its caption says so.
  - A sketch may repeat synced text, as the agent's prose may: a timeline needs its items' titles.
  - A quote belongs in the answer, as a quote from an item (0032), where Oriel checks it.
  - Figures and rows belong in a block, which Oriel builds from a read.
- **When the agent sketches.** Blocks and chips come first. A sketch is for a visual the user asks for that no block draws: a diagram, a timeline, a mockup, a layout.
  - It is taught in one binding, with one line, and nothing in the system prompt:

    ```ts
    /** HTML and CSS, no script or link, when no block can draw it. */
    declare function sketch(html: string, h: 240 | 400 | 640): Promise<string>;
    ```

  - That is about 145 bytes. The module's base is 4,796 bytes today against a budget of 4,800, so the budget rises to 4,950 in the building story.
  - The result of a sketch that is shown names Oriel's theme variables, so the next sketch can use them.
- **Limits.**
  - A sketch is at most 32 KB, and an answer holds at most 2. The host refuses more, as it caps blocks.
  - A sketch is stored with its turn, as Oriel checked it, with its height, as blocks are (0030). Reopening the thread serves it again from the stored copy.
  - It shows under the reply, with the blocks, in the order asked for, in any thread, the window chat's included. It can't be pinned: a pin is a read (0030), and a sketch is text.
  - A review link's page never frames a sketch. Where a sketch would show, it reads "A sketch by the agent, shown in the thread only." A held message's quote shows the same line.
  - The Done page lists threads, not answers, so it shows no sketch. A done thread's page shows its sketches as stored.
  - Telemetry: a sketch shown, with its height and size, and a sketch refused, with the reason (too big, too many, an element not allowed). It never records the text or the names refused. SPEC §7 lists both events with the building story.
  - One eval case: "Draw me a chart of story points by assignee", in the weather epic. It passes on a bars block from a read and no `sketch()`. It guards the one misuse the binding invites: a model's chart in place of Oriel's.
- **Visual identity.** Oriel's theme sheet comes first in the agent's document.
  - The sheet sets `window.css`'s neutral tokens under their own names, light and dark through `prefers-color-scheme`: the background, surface, line and text colours, the fonts, sizes, spaces and radii. The frame follows the page's scheme through its element.
  - The frame never gets the accent, the state colours (danger, inserted, deleted, an item's state) or any button token, so the agent can't draw an exact copy of Approve. In the visual identity spike, two designers' fake Approve drawn with every token matched the real one.
  - It also gives the body, tables, buttons and inputs a plain look in those tokens, so a sketch that names none still fits the page.
  - Oriel's own component styles never enter the frame: the look of a block, a chip, the diff or Approve. The frame's border is one no block has.
  - Which tokens, and their names, follow OA-112, which this waits on.

**Why.**

- Some visuals the user asks for aren't figures from a read: how stories depend on each other, a release timeline, a mockup of a page. A block can't draw them, and the agent's prose draws them badly.
- A loopback harness tested 74 probes in Chrome 156. It used three servers on 127.0.0.1 (Oriel's page, the sketch origin and a sink), plus a UDP listener for STUN. Each probe also ran as a top-level page and in a bare frame, as controls. The design leaked nothing on any of them, with the check, and nothing without the check except the probes below. The harness is kept on the branch `sketch-frame-spike`.
  - CSS alone sends nothing out under `default-src 'none'`. Every control fired, and the design blocked them all:
    - background, `image-set()`, cursor, list-style, border-image, mask, `content` and shape-outside URLs;
    - `@import` and `@font-face`;
    - an attribute selector whose background URL spells out an input's value.
  - The sandbox and CSP blocked the rest too:
    - `img`, `srcset`, SVG `image` and `feImage`, `<link>` in five kinds, `<base>`;
    - a `<meta>` that tries to loosen the CSP;
    - `object`, `embed`, `video` and `audio`;
    - `<meta http-equiv=refresh>`;
    - clicks on links to `_blank`, `_top` and `_parent`, `ping` and `javascript:` links, and a form.
  - In the design, no script runs. With a script allowed inside, for comparison, CSP still blocked fetch, beacon, WebSocket, SSE, `window.open` and `top.location`. STUN still went out, with CSP `webrtc 'block'` or without it, as the reply-elements spike found.
  - Some controls never fired, even on an unprotected page, so they prove nothing: `<link rel=preconnect>` and `dns-prefetch` (the harness sees only a connection or a lookup), speculation rules, an external `use`, and a CSS `filter` URL. The check refuses `link` and `script`.
  - **CSP doesn't stop a preconnect.** Without the check, the design leaked a DNS lookup and a TCP connection, with no request, in 8 probes. The net log marks each `is_preconnect`: Chrome connects before it checks `frame-src`. The probes:
    - an `<iframe src>`, the moment it showed, in four spellings;
    - `<noscript><iframe>`: with scripts off, a sandbox parses `<noscript>` as markup;
    - a click on a link, an SVG link or a download link.

    A DNS name can carry anything the agent read to a server the attacker runs. The check closes this: it refuses every element that can navigate, so isolation has only fetches left to stop, and it stops all of them.

  - The `<noscript>` case is why the check scans text rather than parsing it. A parser assuming scripts on reads `<noscript>`'s content as text, so it would miss the `<iframe>` the sandbox builds.
  - Eight probes tried to get past the scan, and none got anything out: upper case, `<iframe/src>`, a form feed after the name, `<iframe>` inside SVG's `<style>`, in a comment, in `<noscript>`, as `&lt;iframe`, and `"` to break out of `srcdoc`.
  - A `use` of a `data:` SVG holding a link drew nothing in Chrome, so there was nothing to click. The `href` rule doesn't count on that, for an engine that would draw it.
  - The frame's document has an opaque origin. In a dark page its `prefers-color-scheme` is dark, and its sheet's dark tokens apply without a reload.
- Two frames, because one `srcdoc` frame in Oriel's page would take Oriel's CSP: `style-src 'self'` forbids the sketch's styles, and `img-src 'self'` would let it reach Oriel's routes. The outer frame gives the sketch a policy of its own, by header.
- A sketch is honest about what it is only if Oriel says so, outside it. A caption the agent could draw is one it could fake.

**Rejected.**

- **Scripts now.** WebRTC leaks from the double sandbox, and no CSP setting stops it in Chrome 156. A sketch with scripts is a later decision, once that is closed, and the decision must cover navigations a script makes, which preconnect too.
- **Same-origin frames:** `allow-same-origin`, or the outer frame served from Oriel's origin. One missing token or header would put the agent's HTML on Oriel's origin, able to read its routes. On a separate origin it takes two mistakes.
- **Sanitizing HTML into the page instead of isolating it.** A sanitizer rewrites the agent's text through its own parser. Where that parser and the browser's differ, as the `<noscript>` case shows they do, its output is a way in. The check here is not a sanitizer. It refuses, never rewrites, and only over-approximates element names, while the frames stay the wall.
- **HTML in place of blocks.** Oriel can't check a sketch's figures, and SPEC §1's central risk is a coarse view the user can't trust. Blocks stay first.
- **A list of forbidden elements.** The next element that navigates would pass. Only allowed names pass.
- **Relying on CSP alone.** It stops every fetch, but not the preconnect before a navigation.
- **A measured height.** It needs a script inside the frame, or a frame on Oriel's origin.
- **Drawing the sketch as an image** (SVG `foreignObject` in an `img`). Nothing in an image loads or navigates, but it needs well-formed XHTML, and its text can't be selected, scrolled or read by a screen reader.

**Consequences.**

- Amended here, not edited:
  - 0030's "a block is typed data, never HTML" stands. HTML is never in an answer's text, a block or a chip, and is only in a sketch, in a sandboxed frame, per 0033.
  - 0032's "an answer is Markdown prose plus elements Oriel draws, never HTML" reads the same way. A sketch is the agent's, drawn in Oriel's frame, and isn't one of those elements.
- SPEC §2 gains "sketch".
- A story after OA-112 builds sketches:
  - the check;
  - the sketch origin and its route;
  - the frame and its caption;
  - `sketch()`, with the module's budget, and every eval cassette recorded again;
  - storage with the turn;
  - the placeholder;
  - the two telemetry events;
  - the eval case.

  It runs the security reviewer, and five rounds of correctness review, as for the sandbox. It ports the harness to Oriel's real route as a check.

- The harness is re-run whenever Chrome's major version changes, as 0017 asks of Deno, and on the desktop shell's engine before it ships.
- The desktop app (0029) serves the sketch origin from the same server. Whether its shell offers a tighter frame is part of the shell's decision.
