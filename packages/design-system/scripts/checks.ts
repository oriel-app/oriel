// Every check. Oriel's `pnpm check` runs the ones that need no browser, in
// about 2s; `pnpm ui-check` runs them all, the three in headless Chrome too.
// Each prints one line, its time, and its problems, one line each, saying
// what to do.
//
// The workshop's own:
// - guide: every page has what its section needs, and specimen ids are
//   unique and present;
// - index: COMPONENTS.md is what `pnpm index` writes;
// - links: every internal link on every page resolves, anchors included;
// - chrome: the workshop's own pages give every control a name and a focus.
//
// Oriel's, read from the checkout ORIEL names:
// - classes: every class a page documents or a specimen uses is in Oriel's
//   window.css (or, marked proposed, in assets/proposals/), and screens use
//   only classes a component documents;
// - coverage, the other way: every class window.css styles and every
//   component packages/web/src exports is on a guide page, or listed with a
//   reason in UNDOCUMENTED.md; and nothing listed there is on a page now, or
//   gone from Oriel;
// - proposals: no proposal's class is also window.css's, every rule is
//   scoped to a class, and none writes a literal Oriel's theme check forbids;
// - references: every name a page cites (`.connect-actions` in `window.css`,
//   `FieldsStep` in `packages/web/src/connect-steps.tsx`) is in that file
//   now, as many times as the page says; every file it names is there; and
//   no page cites a line. The dated reports (DRIFT.md and CONTROLS.md, with
//   `surveyed:` in their front matter) keep their commit's lines, and are
//   skipped;
// - contrast: every token pair the workshop claims clears its ratio, in
//   every theme and scheme, by Oriel's own contrast code, and Oriel's own
//   theme check passes;
// - accessibility, in headless Chrome: in every specimen, drawn by Oriel's
//   window.css, every control has an accessible name and every tab stop
//   shows focus.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page as Tab } from "playwright-core";
import { coverage, goneClasses, listFile } from "../src/coverage.ts";
import { classesIn, documentedClasses, pages, statuses, type Page } from "../src/guide.ts";
import { refs, sourceRef } from "../src/md.ts";
import {
  check as theme,
  proposalsCss,
  root,
  source,
  themes,
  windowCss,
  windowCssPath,
} from "../src/oriel.ts";
import { start } from "../src/server.ts";
import { judge } from "../src/tokens.ts";
import { where } from "../src/where.ts";
import { componentsIndex } from "./index.ts";

type Browsing = { base: string; browser: Browser };
type Check = {
  name: string;
  browser: boolean;
  run(problems: string[], browsing: () => Promise<Browsing>): number | Promise<number>;
};

const all = pages();
const css = windowCss();
const proposals = proposalsCss();

// Class names a stylesheet's selectors use.
function selectorClasses(sheet: string): Set<string> {
  const out = new Set<string>();
  for (const rule of themes.rules(sheet))
    for (const m of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1] ?? "");
  return out;
}
const oriel = selectorClasses(css);
const proposed = selectorClasses(proposals);

// Classes Oriel dropped that pages held for a review still cite, listed in
// UNDOCUMENTED.md: the class and reference checks let these through.
const gone = goneClasses(all.find((p) => p.file === listFile));

const short = (file: string) => (file === windowCssPath ? "window.css" : file);

const componentSections = [
  "What it is",
  "When to use it",
  "When not to",
  "Anatomy and variants",
  "States",
  "Keyboard and ARIA",
  "Content",
  "Where the app uses it",
];

const views = [
  { query: "", said: "Graphite light" },
  { query: "?theme=broadsheet&scheme=dark", said: "Broadsheet dark" },
];

export const checks: Check[] = [
  {
    name: "guide",
    browser: false,
    run(problems) {
      let n = 0;
      for (const p of all) {
        n++;
        const headings = p.nodes.flatMap((x) => (x.kind === "heading" ? [x.text] : []));
        if (p.section === "components" || p.section === "lab") {
          const status = p.front["status"] ?? "";
          if (!statuses.includes(status as never))
            problems.push(`${p.file}: status "${status}" isn't one of ${statuses.join(", ")}`);
          if (!p.front["summary"])
            problems.push(`${p.file}: no summary: add one to its front matter`);
        }
        if (p.section === "components")
          for (const s of componentSections)
            if (!headings.includes(s)) problems.push(`${p.file}: no "## ${s}" section: add it`);
        if (
          p.section === "components" &&
          p.front["status"] === "drifting" &&
          !headings.includes("Drift")
        )
          problems.push(
            `${p.file}: drifting, with no "## Drift" section: add one saying which version to copy`,
          );
        const ids = new Set<string>();
        for (const s of p.specimens) {
          if (!s.id) problems.push(`${p.file}: a specimen with no id: give it id=<slug>`);
          else if (!/^[a-z0-9-]+$/.test(s.id))
            problems.push(`${p.file}: specimen id "${s.id}" isn't a slug: use a-z, 0-9 and -`);
          if (ids.has(s.id)) problems.push(`${p.file}: two specimens called ${s.id}: rename one`);
          ids.add(s.id);
          if (s.html.includes("<script"))
            problems.push(
              `${p.file}#${s.id}: a script in a specimen: move the behaviour to assets/frame.js`,
            );
        }
      }
      return n;
    },
  },
  {
    name: "classes",
    browser: false,
    run(problems) {
      let n = 0;
      const documented = new Set<string>();
      for (const p of all.filter((x) => x.section === "components" || x.section === "lab"))
        for (const c of documentedClasses(p)) {
          documented.add(c);
          n++;
          if (!oriel.has(c) && !proposed.has(c) && !gone.has(c))
            problems.push(
              `.${c} isn't in window.css, but ${p.file} documents it: restore the class, or update the page`,
            );
          else if (!oriel.has(c) && p.front["status"] === "stable")
            problems.push(
              `${p.file} is stable but documents .${c}, which only a proposal has: add .${c} to window.css, or mark the page proposed`,
            );
        }
      for (const p of all)
        for (const s of p.specimens)
          for (const c of classesIn(s.html)) {
            n++;
            if (!oriel.has(c) && !proposed.has(c) && !gone.has(c))
              problems.push(
                `.${c} isn't in window.css, but ${p.file}#${s.id} uses it: restore the class, or update the specimen`,
              );
            if (p.section === "screens" && !documented.has(c))
              problems.push(
                `${p.file}#${s.id}: a screen uses .${c}, which no component documents: document it on a component page, or drop it from the screen`,
              );
            if (p.section === "screens" && !oriel.has(c))
              problems.push(
                `${p.file}#${s.id}: a screen uses .${c}, which only a proposal has: screens show today's app, so use window.css's class`,
              );
          }
      return n;
    },
  },
  {
    name: "coverage",
    browser: false,
    run(problems) {
      const list = all.find((p) => p.file === listFile);
      if (list === undefined) problems.push(`${listFile} is missing: restore it`);
      const { checked, gaps, stale } = coverage(list);
      for (const g of gaps)
        problems.push(
          g.kind === "class"
            ? `.${g.name} in window.css isn't documented: add it to a page, or to ${listFile} with a reason`
            : `${g.name} in ${g.file} isn't documented: add it to a page, or to ${listFile} with a reason`,
        );
      problems.push(...stale);
      return checked;
    },
  },
  {
    name: "proposals",
    browser: false,
    run(problems) {
      let n = 0;
      for (const c of proposed)
        if (oriel.has(c))
          problems.push(
            `.${c} is in window.css now, and a proposal in assets/proposals/ uses it too: rename the proposal's class`,
          );
      for (const rule of themes.rules(proposals)) {
        if (rule.at.some((a) => a.startsWith("@keyframes"))) continue;
        n++;
        if (!/\.[a-z]/.test(rule.selector) && !/^:root|^html/.test(rule.selector))
          problems.push(
            `assets/proposals/: ${rule.selector} isn't scoped to a class: put it under the proposal's class`,
          );
        for (const d of rule.declarations) {
          const what = theme.literal(d.property, d.value);
          if (what !== null)
            problems.push(
              `assets/proposals/: ${rule.selector} has ${what} in ${d.property}: ${d.value}: use one of window.css's tokens`,
            );
        }
      }
      return n;
    },
  },
  {
    name: "references",
    browser: false,
    run(problems) {
      let n = 0;
      for (const p of all) {
        // A dated report keeps the lines of the commit it names.
        if (p.front["surveyed"] !== undefined) continue;
        // No line anywhere on the page, fences and specimen titles included.
        for (const m of p.text.matchAll(/[\w-]+\.(?:css|tsx?|md|json):\d+/g))
          problems.push(
            `${p.file} cites ${m[0]}: cite the selector or name instead (pnpm -s ds where finds it)`,
          );
        const { files, names } = refs(p.text);
        for (const r of files) {
          n++;
          if (source(r.file) === null)
            problems.push(
              `${p.file} cites ${r.file}, which isn't in the checkout: point it at the file that has it now`,
            );
        }
        for (const r of names) {
          n++;
          if (sourceRef.exec(r.name)?.[2] !== undefined) continue;
          const found = where(r.file, r.name);
          if (found === null)
            problems.push(
              `${p.file} cites ${r.file}, which isn't in the checkout: point it at the file that has it now`,
            );
          else if (found.length === 0) {
            const held = [...r.name.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].some((m) =>
              gone.has(m[1] ?? ""),
            );
            if (!held)
              problems.push(
                `${p.file} cites ${r.name} in ${short(r.file)}, which isn't there: cite its new name (pnpm -s ds where finds one), or update the page`,
              );
          } else if (r.count !== null && found.length !== r.count)
            problems.push(
              `${p.file} says ${r.name} is in ${short(r.file)} ${r.count} times, and it's there ${found.length === 1 ? "once" : `${found.length} times`}: fix the page's count`,
            );
        }
      }
      problems.splice(0, problems.length, ...new Set(problems));
      return n;
    },
  },
  {
    name: "index",
    browser: false,
    run(problems) {
      const on = readFileSync(join(root, "COMPONENTS.md"), "utf8");
      if (on !== componentsIndex())
        problems.push("COMPONENTS.md is stale: run pnpm --filter @oriel/design-system index");
      return 1;
    },
  },
  {
    name: "contrast",
    browser: false,
    run(problems) {
      const judged = judge(css);
      for (const j of judged)
        if (j.claimed && !j.passes)
          problems.push(
            `${j.fg} on ${j.bg} is ${j.ratio.toFixed(2)}:1 in ${j.theme} ${j.scheme}, under ${j.min}:1: change one of the two in window.css`,
          );
      // Oriel's own check, for what the workshop's pairs didn't already say.
      const said = judged
        .filter((j) => j.claimed && !j.passes)
        .map((j) => `${j.theme}, ${j.scheme}: ${j.fg} on ${j.bg} `);
      for (const p of theme.themeProblems(css))
        if (!said.some((x) => p.startsWith(x)))
          problems.push(`Oriel's theme check: ${p}: fix it in window.css`);
      return judged.filter((j) => j.claimed).length;
    },
  },
  {
    name: "links",
    browser: true,
    async run(problems, browsing) {
      const { base, browser } = await browsing();
      const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const urls = ["/", ...all.map((p) => p.url), "/source/packages/web/assets/window.css"];
      const ids = new Map<string, Set<string>>();
      const hrefs: { from: string; href: string }[] = [];
      const found: string[] = [];
      for (const url of urls) {
        const res = await tab.goto(base + url);
        if (!res || res.status() !== 200) {
          found.push(`${url} answers ${res?.status()}: fix the page`);
          continue;
        }
        ids.set(url, new Set(await tab.$$eval("[id]", (els) => els.map((e) => e.id))));
        for (const href of await tab.$$eval("main a[href], nav a[href], main img[srcset]", (els) =>
          els.map((e) => e.getAttribute("href") ?? e.getAttribute("srcset")?.split(" ")[0] ?? ""),
        ))
          if (href.startsWith("/") || href.startsWith("#")) hrefs.push({ from: url, href });
      }
      await tab.close();
      const statusOf = new Map<string, number>();
      for (const { from, href } of hrefs) {
        const url = new URL(href, base + from);
        const path = url.pathname;
        if (!statusOf.has(path)) {
          const res = await fetch(base + path);
          statusOf.set(path, res.status);
          if (
            !ids.has(path) &&
            res.ok &&
            res.headers.get("content-type")?.startsWith("text/html")
          ) {
            const html = await res.text();
            ids.set(path, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? "")));
          }
        }
        if (statusOf.get(path) !== 200)
          found.push(`${from} links to ${href}, which answers ${statusOf.get(path)}: fix the link`);
        else if (url.hash && !ids.get(path)?.has(decodeURIComponent(url.hash.slice(1))))
          found.push(
            `${from} links to ${href}, which has no #${url.hash.slice(1)}: fix the anchor`,
          );
      }
      problems.push(...new Set(found));
      return hrefs.length;
    },
  },
  {
    name: "accessibility",
    browser: true,
    async run(problems, browsing) {
      const { base, browser } = await browsing();
      const jobs = views.flatMap((v) =>
        all.flatMap((p: Page) =>
          p.specimens.map((s) => ({
            url: `/frame${p.url}/${s.id}${v.query}`,
            where: `${p.file}#${s.id} (${v.said})`,
          })),
        ),
      );
      return audits(browser, base, jobs, problems, 40);
    },
  },
  {
    name: "chrome",
    browser: true,
    async run(problems, browsing) {
      const { base, browser } = await browsing();
      const jobs = ["/", "/components/button", "/foundations/colour"].map((url) => ({
        url,
        where: `the workshop's page ${url}`,
      }));
      return audits(browser, base, jobs, problems, 60);
    },
  },
];

// Audit pages in a few tabs at once, each in a context of its own, so one
// tab's focus never touches another's. CHECK_TABS sets how many.
const tabs = Number(process.env["CHECK_TABS"] ?? 4);
async function audits(
  browser: Browser,
  base: string,
  jobs: { url: string; where: string }[],
  problems: string[],
  maxStops: number,
): Promise<number> {
  let next = 0;
  let checked = 0;
  const found: { at: number; said: Finding[] }[] = [];
  const worker = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await context.newPage();
    for (let i = next++; i < jobs.length; i = next++) {
      const job = jobs[i]!;
      const said: Finding[] = [];
      await tab.goto(base + job.url);
      const stops = await audit(tab, job.where, said, maxStops);
      checked += stops;
      found.push({ at: i, said });
    }
    await context.close();
  };
  await Promise.all(Array.from({ length: Math.min(tabs, jobs.length) }, worker));
  // One line per kind of element and problem, with how many places and
  // the first: one rule in window.css is usually behind all of them.
  const kinds = new Map<string, { what: string; fix: string; places: string[] }>();
  for (const f of found.sort((a, b) => a.at - b.at))
    for (const x of f.said) {
      const kind = kinds.get(x.what + x.fix) ?? { what: x.what, fix: x.fix, places: [] };
      kind.places.push(x.where);
      kinds.set(x.what + x.fix, kind);
    }
  for (const { what, fix, places } of kinds.values()) {
    const at =
      places.length === 1 ? `in ${places[0]}` : `in ${places.length} places, first ${places[0]}`;
    problems.push(`${what}, ${at}: ${fix}`);
  }
  return checked;
}

const named = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "listbox",
  "slider",
  "spinbutton",
  "tab",
  "meter",
  "progressbar",
  "img",
]);

type Finding = { what: string; where: string; fix: string };

// Every named role has a name; every tab stop looks different focused.
async function audit(
  tab: Tab,
  where: string,
  problems: Finding[],
  maxStops: number,
): Promise<number> {
  const client = await tab.context().newCDPSession(tab);
  const { nodes } = (await client.send("Accessibility.getFullAXTree")) as {
    nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[];
  };
  await client.detach();
  let n = 0;
  for (const node of nodes) {
    const role = node.role?.value ?? "";
    if (node.ignored || !named.has(role)) continue;
    n++;
    if (!(node.name?.value ?? "").trim())
      problems.push({
        what: `A ${role} with no accessible name`,
        where,
        fix: "give it text, aria-label or aria-labelledby",
      });
  }
  // Every tab stop, in tab order, must look different focused, unless the
  // specimen already forces its focus look. One walk in the page, not a Tab
  // press per stop: the same stops, a quarter of the time, and two stops
  // that look alike are both checked.
  const stops = await tab.evaluate((max) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const look = (e: HTMLElement | null) => {
      if (e === null) return "";
      const s = getComputedStyle(e);
      return [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.boxShadow,
        s.borderColor,
        s.backgroundColor,
        s.textDecorationLine,
      ].join("|");
    };
    // A field whose frame shows focus (:focus-within) counts too.
    const drawn = (e: HTMLElement) => look(e) + look(e.parentElement);
    // An element's kind, for grouping: its tag and classes, the workshop's
    // forced states aside.
    const kind = (el: HTMLElement) =>
      el.tagName.toLowerCase() +
      [...el.classList]
        .filter((c) => !c.startsWith("ws-"))
        .map((c) => `.${c}`)
        .join("");
    // What Tab stops on: focusable, shown, not disabled or inert. A sketch's
    // sandboxed frame is passed over, as Tab finds nothing in it.
    let els = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable]",
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !(el as HTMLButtonElement).disabled &&
        el.checkVisibility() &&
        el.closest("[inert]") === null,
    );
    // One stop per radio group: its checked radio, or its first.
    const radio = (el: HTMLElement) =>
      el instanceof HTMLInputElement && el.type === "radio" && el.name !== "" ? el : null;
    els = els.filter((el) => {
      const r = radio(el);
      if (r === null) return true;
      const group = els.flatMap((x) => {
        const o = radio(x);
        return o && o.name === r.name && o.form === r.form ? [o] : [];
      });
      return (group.find((x) => x.checked) ?? group[0]) === r;
    });
    els = [
      ...els.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex),
      ...els.filter((e) => e.tabIndex === 0),
    ];
    return els.slice(0, max).map((el) => {
      // A customizable listbox takes focus on its option.
      const select = el instanceof HTMLSelectElement ? el : null;
      const into =
        select &&
        (select.size > 1 || select.multiple) &&
        getComputedStyle(select).appearance === "base-select"
          ? (select.selectedOptions[0] ?? select.options[0] ?? el)
          : el;
      into.focus({ focusVisible: true } as FocusOptions);
      const now = document.activeElement as HTMLElement | null;
      const on = now !== null && el.contains(now) ? now : el;
      if (on.closest("[class*='ws-focus']")) return { kind: kind(on), visible: true };
      const focused = drawn(on);
      on.blur();
      return { kind: kind(on), visible: focused !== drawn(on) };
    });
  }, maxStops);
  for (const stop of stops)
    if (!stop.visible)
      problems.push({
        what: `${stop.kind} shows no focus`,
        where,
        fix: "window.css must draw :focus-visible for it",
      });
  return n + stops.length;
}

// Run the checks named (all of `from` when none are), print each, and say
// whether they all pass.
export async function runChecks(from: Check[], asked: string[]): Promise<boolean> {
  const unknown = asked.filter((a) => !from.some((c) => c.name === a));
  if (unknown.length > 0) {
    console.error(
      `No check called ${unknown.join(", ")}. These are: ${from.map((c) => c.name).join(", ")}.`,
    );
    return false;
  }
  const chosen = from.filter((c) => asked.length === 0 || asked.includes(c.name));
  let browsing: Promise<Browsing & { close(): Promise<void> }> | null = null;
  const open = () => {
    browsing ??= (async () => {
      const began = performance.now();
      const server = await start(0);
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        channel: "chrome",
        chromiumSandbox: true,
        headless: true,
      });
      line("", "server, Chrome", "", performance.now() - began);
      return {
        base,
        browser,
        close: async () => {
          await browser.close();
          server.close();
        },
      };
    })();
    return browsing;
  };
  let failed = 0;
  try {
    for (const c of chosen) {
      const problems: string[] = [];
      const began = performance.now();
      const checked = await c.run(problems, open);
      const ms = performance.now() - began;
      if (problems.length > 0) failed++;
      const said = `${checked} checked${problems.length ? `, ${problems.length} problems` : ""}`;
      line(problems.length === 0 ? "ok" : "FAIL", c.name, said, ms);
      for (const p of problems.slice(0, 40)) console.log(`       ${p}`);
      if (problems.length > 40) console.log(`       … and ${problems.length - 40} more`);
    }
  } finally {
    const b = browsing as Promise<{ close(): Promise<void> }> | null;
    if (b) await (await b).close();
  }
  const took = `${(performance.now() / 1000).toFixed(1)}s`;
  console.log(
    failed === 0 ? `\nAll checks pass, in ${took}.` : `\n${failed} checks failed, in ${took}.`,
  );
  return failed === 0;
}

function line(mark: string, name: string, said: string, ms: number) {
  console.log(`${mark.padEnd(4)} ${name.padEnd(14)} ${said.padEnd(28)} ${(ms / 1000).toFixed(1)}s`);
}
