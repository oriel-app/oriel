import { readdirSync } from "node:fs";
import { join } from "node:path";
import { escape, inline } from "./md.ts";
import { check, oriel, source, themes, windowCss, windowCssPath } from "./oriel.ts";
import { breakpoints, groups, hex, judge, schemes, shared, value } from "./tokens.ts";

export type Live = { md: string; html: string };

type Table = { head: string[]; rows: string[][] };

const oneLine = (c: string) => c.replace(/\s+/g, " ");

const mdTable = ({ head, rows }: Table): string =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map((c) => oneLine(c).replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");

const htmlTable = ({ head, rows }: Table, cell = inline): string =>
  `<div class="ws-table"><table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

const both = (t: Table, cell?: (c: string) => string): Live => ({
  md: mdTable(t),
  html: htmlTable(t, cell),
});

const swatchCell = (c: string): string => {
  const m = /^(#[0-9a-f]{6,8})$/.exec(c);
  if (!m) return inline(c);
  return `<span class="ws-swatch" style="--ws-swatch: ${m[1]}"></span><code>${m[1]}</code>`;
};

function colour(): Live {
  const css = windowCss();
  const names = themes.themeNames(css);
  const head = ["Token", ...names.flatMap((t) => schemes.map((s) => `${t} ${s}`))];
  const rows = [...check.colourTokens.filter((n) => n !== "--tint"), ...groups["derived"]!]
    .filter((n) => n !== "--scrim")
    .map((name) => [
      `\`${name}\``,
      ...names.flatMap((t) => schemes.map((s) => hex(css, t, s, name))),
    ]);
  return both({ head, rows }, swatchCell);
}

function contrast(): Live {
  const judged = judge();
  const md: string[] = [];
  const html: string[] = [];
  const fails = judged.filter((j) => j.claimed && !j.passes);
  const lines = judged.filter((j) => !j.claimed && !j.passes);
  const claimed = judged.filter((j) => j.claimed);
  const summary = `${claimed.length} claimed pairs across ${new Set(judged.map((j) => j.theme)).size} themes, light and dark: ${fails.length === 0 ? "all pass" : `**${fails.length} fail**`}. Worst text pair: ${worst(claimed.filter((j) => j.min === 4.5))}. Worst non-text pair: ${worst(claimed.filter((j) => j.min === 3))}.`;
  md.push(summary);
  html.push(`<p class="ws-summary">${inline(summary)}</p>`);
  for (const theme of new Set(judged.map((j) => j.theme)))
    for (const scheme of schemes) {
      const these = judged.filter((j) => j.theme === theme && j.scheme === scheme);
      const text = these.filter((j) => j.kind === "text");
      const bgs = [...new Set(text.map((j) => j.bg))];
      const fgs = [...new Set(text.map((j) => j.fg))];
      const cell = (fg: string, bg: string) => {
        const j = these.find((x) => x.fg === fg && x.bg === bg);
        return j ? `${j.ratio.toFixed(2)}${j.passes ? "" : " ✗"}` : "";
      };
      const title = `${theme}, ${scheme}`;
      const matrix: Table = {
        head: ["Text on", ...bgs.map((b) => `\`${b}\``)],
        rows: fgs.map((fg) => [`\`${fg}\``, ...bgs.map((bg) => cell(fg, bg))]),
      };
      const others: Table = {
        head: ["Pair", "Needs", "Ratio"],
        rows: these
          .filter((j) => j.kind !== "text")
          .map((j) => [
            `\`${j.fg}\` on \`${j.bg}\`${j.claimed ? "" : " (reported, not claimed)"}`,
            `${j.min}:1`,
            `${j.ratio.toFixed(2)}${j.passes ? "" : " ✗"}`,
          ]),
      };
      md.push(`#### ${title}`, "", mdTable(matrix), "", mdTable(others));
      const paint = (c: string) => {
        const ratio = parseFloat(c);
        if (Number.isNaN(ratio)) return inline(c);
        return `<span class="ws-ratio" data-fails="${c.includes("✗")}">${escape(c)}</span>`;
      };
      html.push(
        `<h4 id="contrast-${theme}-${scheme}">${escape(title)}</h4>`,
        htmlTable(matrix, paint),
        htmlTable(others, paint),
      );
    }
  if (lines.length > 0) {
    const note = `Hairlines aren't claimed: \`--line\` and \`--line-strong\` sit at ${range(lines)}:1 against their backgrounds, under the 3:1 a control's only edge would need. Oriel's fields and buttons are told by their label and fill too, so this is reported, not failed.`;
    md.push(note);
    html.push(`<p class="ws-note">${inline(note)}</p>`);
  }
  return { md: md.join("\n\n"), html: html.join("\n") };
}

const worst = (
  list: { fg: string; bg: string; ratio: number; theme: string; scheme: string }[],
) => {
  const w = list.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  return `\`${w.fg}\` on \`${w.bg}\`, ${w.ratio.toFixed(2)}:1 (${w.theme}, ${w.scheme})`;
};

const range = (list: { ratio: number }[]) => {
  const r = list.map((j) => j.ratio);
  return `${Math.min(...r).toFixed(2)} to ${Math.max(...r).toFixed(2)}`;
};

function tokenGroup(group: string): Live {
  const names = groups[group];
  if (names === undefined) throw new Error(`No token group called ${group}`);
  const css = windowCss();
  const themeList = themes.themeNames(css);
  const sharedValues = shared(css);
  const head = ["Token", ...themeList];
  const rows = names.map((name) => {
    const own = sharedValues.get(name);
    if (own !== undefined || group === "layout")
      return [
        `\`${name}\``,
        ...themeList.map(
          () =>
            `\`${own ?? (value(css, themeList[0]!, "light", name) || "set in a rule")}\` (shared)`,
        ),
      ];
    return [
      `\`${name}\``,
      ...themeList.map((t) => {
        const light = value(css, t, "light", name);
        const dark = value(css, t, "dark", name);
        return light === dark ? `\`${light}\`` : `\`${light}\` light, \`${dark}\` dark`;
      }),
    ];
  });
  return both({ head, rows });
}

function breakpointList(): Live {
  const rows = breakpoints().map((b) => [
    `\`${b.at}\``,
    `\`window.css:${b.line}\``,
    String(b.rules),
  ]);
  return both({ head: ["Query", "Starts at", "Rules"], rows });
}

function themeCheck(): Live {
  const problems = check.themeProblems(windowCss());
  const said =
    problems.length === 0
      ? `Oriel's own theme check (\`scripts/check-themes.ts\`) passes on this checkout: every theme, light and dark, clears its contrast, its states' separation and its values-not-rules rules.`
      : `Oriel's own theme check finds ${problems.length} problems:\n\n${problems.map((p) => `- ${p}`).join("\n")}`;
  return { md: said, html: `<p class="ws-summary">${inline(said)}</p>` };
}

type Icon = { name: string; file: string; line: number; svg: string };

export function icons(): Icon[] {
  const dir = join(oriel, "packages/web/src");
  const out: Icon[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".tsx"))
    .sort()) {
    const file = `packages/web/src/${f}`;
    const text = source(file) ?? "";
    for (const m of text.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)) {
      const [whole, attrs = "", body = ""] = m;
      if (body.includes("{") || attrs.includes("{")) continue;
      const before = text.slice(0, m.index);
      const name = [...before.matchAll(/function (\w+)/g)].at(-1)?.[1] ?? "?";
      const line = before.split("\n").length;
      out.push({ name, file, line, svg: whole.replace(/\s+/g, " ") });
    }
  }
  return out;
}

function iconList(): Live {
  const list = icons();
  const md = mdTable({
    head: ["Icon", "Class", "Where"],
    rows: list.map((i) => [
      i.name,
      `\`${/class="([^"]+)"/.exec(i.svg)?.[1] ?? ""}\``,
      `\`${i.file}:${i.line}\``,
    ]),
  });
  const html = `<ul class="ws-icons">${list
    .map(
      (i) =>
        `<li><span class="ws-icon" aria-hidden="true">${i.svg.replace(/class="[^"]*"/, 'class="ws-icon-svg"')}</span><span>${escape(i.name)}</span>${inline(`\`${i.file}:${i.line}\``)}</li>`,
    )
    .join("")}</ul>`;
  return { md, html };
}

function reducedMotion(): Live {
  const css = windowCss();
  const rows = themes
    .rules(css)
    .filter((r) => r.at.some((a) => a.includes("prefers-reduced-motion")))
    .map((r) => [
      `\`${r.selector}\``,
      r.declarations.map((d) => `\`${d.property}: ${d.value}\``).join(", "),
      `\`window.css:${r.line}\``,
    ]);
  return both({ head: ["Selector", "What it sets", "Where"], rows });
}

function motionList(): Live {
  const css = windowCss();
  const rows = themes
    .rules(css)
    .filter(
      (r) => !r.at.some((a) => a.includes("prefers-reduced-motion") || a.startsWith("@keyframes")),
    )
    .flatMap((r) =>
      r.declarations
        .filter((d) => d.property === "transition" || d.property === "animation")
        .map((d) => [`\`${r.selector}\``, `\`${d.value}\``, `\`window.css:${d.line}\``]),
    );
  return both({ head: ["Selector", "Motion", "Where"], rows });
}

export function census(css = windowCss()): { measure: string; count: number; where: string[] }[] {
  const token = /^(?:html|:root(?:\[data-theme="[^"]+"\])?|html\[data-text-size(?:="[a-z]+")?\])$/;
  const plain = themes
    .rules(css)
    .filter((r) => !token.test(r.selector) && !r.at.some((a) => a.startsWith("@keyframes")));
  const bare = (v: string) => v.replace(/var\([^()]*(?:\([^()]*\))?[^()]*\)/g, " ");
  const px: string[] = [];
  const rem: string[] = [];
  const z: string[] = [];
  const spacing = /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-|$)/;
  for (const r of plain)
    for (const d of r.declarations) {
      if (d.property.startsWith("--")) continue;
      const v = bare(d.value);
      const at = `window.css:${d.line}`;
      if (/(?:^|[\s(,-])\d*\.?\d+px\b/.test(v)) px.push(`${at} ${d.property}`);
      if (spacing.test(d.property) && /(?:^|[\s(,-])\d*\.?\d+rem\b/.test(v))
        rem.push(`${at} ${d.property}`);
      if (d.property === "z-index" && /^\d+$/.test(d.value.trim())) z.push(`${at} ${d.value}`);
    }
  const seen = new Map<string, number[]>();
  for (const r of plain.filter((x) => x.at.length === 0))
    seen.set(r.selector, [...(seen.get(r.selector) ?? []), r.line]);
  const dups = [...seen]
    .filter(([, lines]) => lines.length > 1)
    .map(([sel, lines]) => `${sel} (${lines.map((l) => `window.css:${l}`).join(", ")})`);
  const dir = join(oriel, "packages/web/src");
  const src = readdirSync(dir)
    .map((f) => source(`packages/web/src/${f}`) ?? "")
    .join("\n");
  const classes = new Set(
    plain.flatMap((r) => [...r.selector.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1] ?? "")),
  );
  // A whole class name: .badge isn't named by provider-badge.
  const named = (c: string) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(src);
  const dead = [...classes].filter((c) => !named(c)).map((c) => `.${c}`);
  return [
    { measure: "Raw px outside token blocks", count: px.length, where: px },
    { measure: "Raw rem in spacing, not a --space-* token", count: rem.length, where: rem },
    { measure: "z-index literals (no layer scale)", count: z.length, where: z },
    { measure: "Selectors written as two top-level rules", count: dups.length, where: dups },
    {
      measure: "Classes styled but never named in packages/web/src",
      count: dead.length,
      where: dead,
    },
  ];
}

function censusTable(): Live {
  const rows = census().map((c) => [
    c.measure,
    String(c.count),
    c.where
      .slice(0, 6)
      .map((w) => w.replace(/(window\.css:\d+)/, "`$1`"))
      .join("; ") + (c.where.length > 6 ? "; …" : ""),
  ]);
  return both({ head: ["Measure", "Now", "Some of them"], rows });
}

export function live(name: string, args: string[]): Live {
  switch (name) {
    case "colour":
      return colour();
    case "contrast":
      return contrast();
    case "tokens":
      return tokenGroup(args[0] ?? "");
    case "breakpoints":
      return breakpointList();
    case "themecheck":
      return themeCheck();
    case "icons":
      return iconList();
    case "reduced-motion":
      return reducedMotion();
    case "motion":
      return motionList();
    case "census":
      return censusTable();
    default:
      throw new Error(`No live table called ${name} (in ${windowCssPath})`);
  }
}
