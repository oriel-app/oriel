// `pnpm index`: writes COMPONENTS.md from the guide's pages, in the shape oxfmt leaves it.
// `pnpm check` fails when it is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { documentedClasses, type Page, pages, sections } from "../src/guide.ts";
import { root } from "../src/oriel.ts";

export function componentsIndex(): string {
  const all = pages();
  const line = (p: Page) => {
    const classes = documentedClasses(p)
      .map((c) => `\`.${c}\``)
      .join(" ");
    const status = p.front["status"] ? ` **${p.front["status"]}**.` : "";
    const summary = p.front["summary"] ? ` ${p.front["summary"]}` : "";
    return `- [${p.title}](${p.file}):${status}${summary}${classes ? ` Classes: ${classes}.` : ""}`;
  };
  const out = [
    "# Oriel components",
    "",
    "<!-- Written by `pnpm --filter @oriel/design-system index` from guide/. Don't edit by hand. -->",
    "",
    "The index of Oriel's design system, for builders. Each line names a page; `cat` its file for the rules. Specimens in a page are HTML with Oriel's real classes, styled by its real `window.css`. Statuses: **stable** (one version in the app), **drifting** (several; the page says which to copy), **proposed** (not in the app yet; its styles are in `assets/proposals.css`).",
    "",
    "Live tables (tokens, contrast, breakpoints) aren't in the files: run `pnpm -s ds <page>` (such as `pnpm -s ds foundations/colour`) to print a page with them filled in from the Oriel checkout.",
    "",
  ];
  for (const s of sections) {
    const list = all.filter((p) => p.section === s.id && p.slug !== "readme");
    if (list.length === 0) continue;
    out.push(`## ${s.title}`, "", s.blurb, "", ...list.map(line), "");
  }
  return out.join("\n");
}

if (import.meta.main) {
  writeFileSync(join(root, "COMPONENTS.md"), componentsIndex());
  console.log("Wrote COMPONENTS.md");
}
