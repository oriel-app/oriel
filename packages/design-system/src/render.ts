import { escape, type Fence, html, inline, type Node } from "./md.ts";
import {
  documentedClasses,
  isSpecimen,
  type Page,
  pages,
  sections,
  snippet,
  specimen,
  type Specimen,
} from "./guide.ts";
import { live } from "./live.ts";
import { proposalsCss, textSizes, themes, windowCss } from "./oriel.ts";

export type View = {
  theme: string;
  scheme: "light" | "dark" | "system";
  size: string;
  vp: "wide" | "390";
};

export function view(params: URLSearchParams): View {
  const css = windowCss();
  const theme = params.get("theme") ?? "";
  const scheme = params.get("scheme") ?? "";
  const size = params.get("size") ?? "";
  return {
    theme: themes.themeNames(css).includes(theme) ? theme : themes.defaultTheme,
    scheme: scheme === "light" || scheme === "dark" ? scheme : "system",
    size: textSizes(css).includes(size) ? size : "default",
    vp: params.get("vp") === "390" ? "390" : "wide",
  };
}

export function query(v: View, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (v.theme !== themes.defaultTheme) p.set("theme", v.theme);
  if (v.scheme !== "system") p.set("scheme", v.scheme);
  if (v.size !== "default") p.set("size", v.size);
  if (v.vp !== "wide") p.set("vp", v.vp);
  for (const [k, val] of Object.entries(extra)) p.set(k, val);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const htmlAttrs = (v: View) =>
  `data-theme="${escape(v.theme)}"${v.size === "default" ? "" : ` data-text-size="${escape(v.size)}"`}`;

const statusBadge = (status: string | undefined) =>
  status ? `<span class="ws-status" data-status="${escape(status)}">${escape(status)}</span>` : "";

export function shell(v: View, title: string, main: string, current = ""): string {
  const css = windowCss();
  const themeOptions = themes
    .themeNames(css)
    .map(
      (t) =>
        `<option value="${t}"${t === v.theme ? " selected" : ""}>${t[0]?.toUpperCase()}${t.slice(1)}</option>`,
    )
    .join("");
  const sizeOptions = textSizes(css)
    .map(
      (s) =>
        `<option value="${s}"${s === v.size ? " selected" : ""}>${s[0]?.toUpperCase()}${s.slice(1)}</option>`,
    )
    .join("");
  const radio = (name: string, value: string, label: string, on: boolean) =>
    `<label class="ws-seg-option"><input type="radio" name="${name}" value="${value}"${on ? " checked" : ""}><span>${label}</span></label>`;
  return `<!doctype html>
<html lang="en" ${htmlAttrs(v)} data-ws-vp="${v.vp}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Oriel design system</title>
<link rel="stylesheet" id="ws-tokens" href="/oriel/tokens.css${v.scheme === "system" ? "" : `?scheme=${v.scheme}`}">
<link rel="stylesheet" href="/assets/workshop.css">
<script type="module" src="/assets/workshop.js"></script>
</head>
<body class="ws">
<a class="ws-skip" href="#main">Skip to content</a>
<header class="ws-top">
  <a class="ws-brand" href="/">Oriel <span>design system</span></a>
  <div class="ws-search" role="search">
    <label class="ws-visually-hidden" for="ws-search">Search the guide</label>
    <input id="ws-search" type="search" placeholder="Search components, classes, tokens" autocomplete="off" aria-controls="ws-results" aria-expanded="false">
    <ul id="ws-results" class="ws-results" role="listbox" aria-label="Search results" hidden></ul>
  </div>
  <div class="ws-controls">
    <label class="ws-control"><span>Theme</span><select id="ws-theme">${themeOptions}</select></label>
    <fieldset class="ws-seg" id="ws-scheme"><legend class="ws-visually-hidden">Scheme</legend>
      ${radio("scheme", "light", "Light", v.scheme === "light")}${radio("scheme", "dark", "Dark", v.scheme === "dark")}${radio("scheme", "system", "System", v.scheme === "system")}
    </fieldset>
    <label class="ws-control"><span>Text size</span><select id="ws-size">${sizeOptions}</select></label>
    <fieldset class="ws-seg" id="ws-vp"><legend class="ws-visually-hidden">Viewport</legend>
      ${radio("vp", "wide", "1280", v.vp === "wide")}${radio("vp", "390", "390", v.vp === "390")}
    </fieldset>
  </div>
</header>
<div class="ws-layout">
<nav class="ws-nav" aria-label="Guide">${nav(current)}</nav>
<main id="main" class="ws-main" tabindex="-1">
${main}
</main>
</div>
</body>
</html>`;
}

function nav(current: string): string {
  const all = pages();
  return sections
    .map((s) => {
      const list = all.filter((p) => p.section === s.id && p.slug !== "readme");
      if (list.length === 0) return "";
      const items = list
        .map(
          (p) =>
            `<li><a href="${p.url}"${p.url === current ? ' aria-current="page"' : ""}>${escape(p.title)}${p.front["status"] && p.front["status"] !== "stable" ? `<span class="ws-dot" data-status="${escape(p.front["status"])}" title="${escape(p.front["status"])}"></span>` : ""}</a></li>`,
        )
        .join("");
      return `<h2>${escape(s.title)}</h2><ul>${items}</ul>`;
    })
    .join("");
}

export const frameUrl = (p: Page, id: string, v: View) =>
  `/frame${p.url}/${encodeURIComponent(id)}${query({ ...v, vp: "wide" })}`;

function specimenFigure(p: Page, s: Specimen, v: View): string {
  const screen = s.flags.includes("screen");
  const side = s.info["side"];
  const copy = escape(snippet(s.html));
  const height = s.info["height"] ? ` style="--ws-height: ${Number(s.info["height"])}px"` : "";
  const tags = [
    side
      ? `<span class="ws-side" data-side="${escape(side)}">${side === "today" ? "Today" : "Proposed"}</span>`
      : "",
    s.info["state"] ? `<span class="ws-state">${escape(s.info["state"])}</span>` : "",
  ].join("");
  return `<figure class="ws-specimen" id="${escape(s.id)}"${screen ? " data-screen" : ""}${s.info["width"] ? ` data-width="${escape(s.info["width"])}"` : ""}>
<figcaption><a class="ws-spec-title" href="#${escape(s.id)}">${inline(s.title)}</a>${tags}<a class="ws-open" href="${frameUrl(p, s.id, v)}">Open alone</a></figcaption>
<div class="ws-stage"${height}><iframe title="Specimen: ${escape(s.title.replace(/`/g, ""))}" src="${frameUrl(p, s.id, v)}"${screen ? ' scrolling="yes"' : ""}></iframe></div>
${s.flags.includes("nocopy") ? "" : `<details class="ws-snippet"><summary>Markup</summary><button type="button" class="ws-copy" data-copy>Copy</button><pre><code>${copy}</code></pre></details>`}
</figure>`;
}

function renderFence(p: Page, v: View) {
  return (fence: Fence): string | null => {
    if (isSpecimen(fence)) return specimenFigure(p, specimen(fence), v);
    if (fence.lang === "live") {
      const [name = "", ...args] = liveArgs(fence.flags, fence.text);
      try {
        return `<div class="ws-live">${live(name, args).html}</div>`;
      } catch (error) {
        return `<p class="ws-error">${escape((error as Error).message)}</p>`;
      }
    }
    return null;
  };
}

function grouped(nodes: Node[], render: (n: Node[]) => string): string {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (run.length > 1) out.push(`<div class="ws-compare">${render(run)}</div>`);
    else if (run.length === 1) out.push(render(run));
    run = [];
  };
  for (const node of nodes) {
    if (node.kind === "fence" && isSpecimen(node.fence) && node.fence.info["side"]) run.push(node);
    else {
      flush();
      out.push(render([node]));
    }
  }
  flush();
  return out.join("\n");
}

function isOriels(c: string): boolean {
  return (
    new RegExp(`\\.${c}(?![\\w-])`).test(windowCss()) ||
    !new RegExp(`\\.${c}(?![\\w-])`).test(proposalsCss())
  );
}

export function guidePage(p: Page, v: View): string {
  const render = { fence: renderFence(p, v), at: p.front["surveyed"] };
  const body = p.nodes.filter((n) => !(n.kind === "heading" && n.level === 1));
  const toc = body
    .filter((n): n is Extract<Node, { kind: "heading" }> => n.kind === "heading" && n.level === 2)
    .map((n) => `<li><a href="#${n.id}">${inline(n.text)}</a></li>`)
    .join("");
  const classes = documentedClasses(p);
  const meta = [
    p.front["summary"] ? `<p class="ws-lede">${inline(p.front["summary"])}</p>` : "",
    `<dl class="ws-meta">`,
    p.front["status"] ? `<div><dt>Status</dt><dd>${statusBadge(p.front["status"])}</dd></div>` : "",
    classes.length
      ? `<div><dt>Classes</dt><dd>${classes.map((c) => (isOriels(c) ? `<code>.${escape(c)}</code>` : `<code class="ws-proposed-class" title="Proposed: only in assets/proposals">.${escape(c)}</code>`)).join(" ")}</dd></div>`
      : "",
    `<div><dt>Plain text</dt><dd><a href="${p.url}.md"><code>${escape(p.file)}</code></a></dd></div>`,
    `</dl>`,
  ].join("");
  const main = `<article class="ws-page" data-section="${p.section}">
<header class="ws-page-head"><p class="ws-eyebrow">${escape(sections.find((s) => s.id === p.section)?.title ?? "")}</p><h1>${escape(p.title)}</h1>${meta}</header>
${toc ? `<nav class="ws-toc" aria-label="On this page"><h2>On this page</h2><ul>${toc}</ul></nav>` : ""}
<div class="ws-prose">${grouped(body, (nodes) => html(nodes, render))}</div>
</article>`;
  return shell(v, p.title, main, p.url);
}

const liveArgs = (flags: string[], text: string): string[] =>
  flags.length > 0 ? flags : text.trim().split(/\s+/);

export function plainText(p: Page): string {
  return p.text.replace(/^```live([^\n]*)\n([\s\S]*?)```$/gm, (_, after: string, body: string) => {
    const [name = "", ...args] = liveArgs(after.trim() ? after.trim().split(/\s+/) : [], body);
    try {
      return live(name, args).md;
    } catch (error) {
      return `(live table failed: ${(error as Error).message})`;
    }
  });
}

export function frame(p: Page, s: Specimen, v: View): string {
  const bg = s.info["bg"] ?? (s.flags.includes("screen") ? "bg" : "bg");
  const pad = s.flags.includes("screen") || s.info["pad"] === "0" ? "0" : "1";
  const schemeQuery = v.scheme === "system" ? "" : `?scheme=${v.scheme}`;
  return `<!doctype html>
<html lang="en" ${htmlAttrs(v)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(s.title.replace(/`/g, ""))} · ${escape(p.title)}</title>
<link rel="stylesheet" id="ws-window" href="/oriel/window.css${schemeQuery}">
<link rel="stylesheet" id="ws-states" href="/oriel/states.css${schemeQuery}">
<link rel="stylesheet" id="ws-proposals" href="/assets/proposals.css${schemeQuery}">
<link rel="stylesheet" id="ws-proposed-states" href="/oriel/proposed-states.css${schemeQuery}">
<link rel="stylesheet" href="/assets/frame.css">
<script type="module" src="/assets/frame.js"></script>
</head>
<body class="ws-frame" data-ws-bg="${escape(bg)}" data-ws-pad="${pad}">
<main class="ws-frame-main">
${s.html}
</main>
</body>
</html>`;
}

export function indexPage(v: View): string {
  const all = pages();
  const card = (p: Page) =>
    `<li class="ws-card"><a href="${p.url}"><span class="ws-card-title">${escape(p.title)}</span>${statusBadge(p.front["status"])}</a>${p.front["summary"] ? `<p>${inline(p.front["summary"])}</p>` : ""}${
      documentedClasses(p).length
        ? `<p class="ws-card-classes">${documentedClasses(p)
            .slice(0, 6)
            .map((c) => `<code>.${escape(c)}</code>`)
            .join(" ")}</p>`
        : ""
    }</li>`;
  const counts = (["stable", "drifting", "proposed"] as const)
    .map(
      (s) =>
        `${all.filter((p) => p.section === "components" && p.front["status"] === s).length} ${s}`,
    )
    .join(" · ");
  const blocks = sections
    .map((s) => {
      const list = all.filter((p) => p.section === s.id && p.slug !== "readme");
      if (list.length === 0) return "";
      return `<section class="ws-section" aria-labelledby="sec-${s.id}"><h2 id="sec-${s.id}">${escape(s.title)}</h2><p class="ws-blurb">${escape(s.blurb)}${s.id === "components" ? ` ${counts}.` : ""}</p><ul class="ws-cards">${list.map(card).join("")}</ul></section>`;
    })
    .join("");
  const main = `<article class="ws-page ws-index">
<header class="ws-page-head"><h1>Oriel design system</h1>
<p class="ws-lede">What Oriel draws, when to use each piece, and the rules it follows. Every specimen here is styled by Oriel's own <code>window.css</code>, read live from the checkout, so what you see is what the app ships today. Proposals are marked, and sit beside today's.</p>
<p>Builders: every page is plain text too. In an Oriel worktree, read <code>COMPONENTS.md</code> here, or a page's file, such as <a href="/components/button.md"><code>guide/components/button.md</code></a>. Start with the <a href="/drift">drift report</a> and the <a href="/controls">controls report</a>.</p>
</header>
${blocks}
</article>`;
  return shell(v, "Index", main, "/");
}

export function searchIndex(): unknown[] {
  return pages().map((p) => ({
    url: p.url,
    title: p.title,
    section: sections.find((s) => s.id === p.section)?.title ?? "",
    status: p.front["status"] ?? "",
    summary: p.front["summary"] ?? "",
    classes: documentedClasses(p),
    headings: p.nodes.flatMap((n) =>
      n.kind === "heading" && n.level > 1 ? [{ text: n.text, id: n.id }] : [],
    ),
    specimens: p.specimens.map((s) => ({ id: s.id, title: s.title })),
  }));
}

export function sourcePage(path: string, text: string, v: View, at?: string): string {
  const lines = text.split("\n");
  const width = String(lines.length).length;
  const body = lines
    .map(
      (l, i) =>
        `<span class="ws-line" id="L${i + 1}"><a href="#L${i + 1}" class="ws-ln" aria-label="Line ${i + 1}">${String(i + 1).padStart(width, " ")}</a>${escape(l)}</span>`,
    )
    .join("\n");
  const main = `<article class="ws-page ws-source"><header class="ws-page-head"><p class="ws-eyebrow">${at ? `Oriel source at <code>${escape(at)}</code>, as the report was written` : "Oriel source, read live"}</p><h1><code>${escape(path)}</code></h1></header><pre class="ws-code ws-listing"><code>${body}</code></pre></article>`;
  return shell(v, path, main);
}

export function notFound(v: View, what: string): string {
  return shell(
    v,
    "Not found",
    `<article class="ws-page"><h1>Nothing here</h1><p>${escape(what)}</p><p><a href="/">Back to the index</a></p></article>`,
  );
}
