// The Oriel checkout the workshop documents, read live. Nothing here copies
// Oriel's styles: window.css is read from the checkout on every request, and
// its themes, tokens and contrast are judged by Oriel's own code
// (packages/web/themes.ts and scripts/check-themes.ts), imported at run time
// so a change to either shows up here at once.
//
// By default it is the checkout this package is in. `ORIEL=/path/to/a/worktree
// pnpm design` points the workshop at another, such as a builder's worktree.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAt, readIn, readShown } from "./files.ts";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A relative ORIEL is from where the command ran: pnpm sets INIT_CWD to it,
// even with --dir, so `ORIEL=. pnpm --dir <this checkout> ui-check` works
// from a worktree.
export const oriel = resolve(
  process.env["INIT_CWD"] ?? process.cwd(),
  process.env["ORIEL"] ?? join(root, "../.."),
);
export const windowCssPath = "packages/web/assets/window.css";

export type Scheme = "light" | "dark";
export type Rgba = [number, number, number, number];
export type Rule = {
  selector: string;
  at: string[];
  line: number;
  declarations: { property: string; value: string; line: number }[];
};

// What the workshop uses from packages/web/themes.ts.
export type Themes = {
  defaultTheme: string;
  rules(css: string): Rule[];
  themeNames(css: string): string[];
  tokens(css: string, theme: string, scheme: Scheme): Map<string, string>;
  resolve(value: string, values: ReadonlyMap<string, string>): string;
};

// What the workshop uses from scripts/check-themes.ts: the pairs Oriel's own
// check judges, and how it judges them.
export type ThemeCheck = {
  contrast(fg: Rgba, bg: Rgba): number;
  parseColor(text: string): Rgba;
  painted(c: Rgba): Rgba;
  themeColour(css: string, theme: string, scheme: Scheme, name: string): Rgba;
  literal(property: string, value: string): string | null;
  textTokens: string[];
  backgrounds: string[];
  onSoft: string[];
  onAccent: string[];
  scanned: string[];
  colourTokens: string[];
  themeTokens: string[];
  minContrast: number;
  themeProblems(css: string): string[];
};

if (!existsSync(join(oriel, windowCssPath)))
  throw new Error(`No Oriel checkout at ${oriel}: set ORIEL to one (see README).`);

const load = async <T>(path: string): Promise<T> =>
  (await import(pathToFileURL(join(oriel, path)).href)) as T;

export const themes = await load<Themes>("packages/web/themes.ts");
export const check = await load<ThemeCheck>("scripts/check-themes.ts");

// window.css as it is now in the checkout.
export function windowCss(): string {
  return readFileSync(join(oriel, windowCssPath), "utf8");
}

const checkout = realpathSync.native(oriel);

// A file in the checkout, by repo-relative path, or null if there is none.
export const source = (path: string) => readIn(checkout, path);

// A file the workshop's server may show, by repo-relative path: see files.ts.
export const shownSource = (path: string) => readShown(checkout, path);

// A file as it was at an Oriel commit, for the dated reports' line links. A
// read-only `git show`; it changes nothing in the checkout.
export const sourceAt = (path: string, commit: string) => readAt(checkout, path, commit);

// The text sizes Settings offers, as window.css's `html[data-text-size]`
// rules have them, after the default.
export function textSizes(css: string): string[] {
  const sizes = themes
    .rules(css)
    .flatMap((r) => /^html\[data-text-size="([a-z]+)"\]$/.exec(r.selector)?.[1] ?? []);
  return ["default", ...sizes];
}

// window.css for one scheme. Light and dark are the system's choice in
// Oriel, through `prefers-color-scheme`; a specimen picks one by having its
// stylesheet answer that query one way, so the rules stay exactly Oriel's.
export function cssForScheme(css: string, scheme: Scheme | "system"): string {
  if (scheme === "system") return css;
  return css.replace(/@media\s*\(prefers-color-scheme:\s*(light|dark)\)/g, (_, said: string) =>
    said === scheme ? "@media all" : "@media not all",
  );
}

// Pseudo-classes a specimen can show without a pointer: `:hover` becomes
// `.ws-hover`, and so on. The rules are window.css's own, copied with only
// their selectors changed, so a forced hover is exactly the real one.
export const forcible = ["hover", "focus-visible", "focus-within", "focus", "active"] as const;

export function forcedStates(css: string): string {
  const out: string[] = [];
  const state = `:(${forcible.join("|")})(?![a-z-])`;
  const has = new RegExp(state);
  const pseudo = new RegExp(state, "g");
  for (const rule of themes.rules(css)) {
    if (rule.at.some((a) => a.startsWith("@keyframes"))) continue;
    const forced = rule.selector
      .split(/,(?![^(]*\))/)
      .filter((s) => has.test(s))
      .map((s) => s.replace(pseudo, (_, state: string) => `.ws-${state}`).trim());
    if (forced.length === 0) continue;
    const body = rule.declarations.map((d) => `${d.property}: ${d.value};`).join(" ");
    let text = `${forced.join(", ")} { ${body} }`;
    for (const at of [...rule.at].reverse()) text = `${at} { ${text} }`;
    out.push(text);
  }
  return out.join("\n") + "\n";
}

// Only window.css's token blocks: the shared tokens on `html`, every theme's
// `:root` blocks and the text sizes. The workshop's own chrome reads these,
// so it wears the theme it shows without Oriel's rules reaching it.
export function tokenCss(css: string): string {
  const token =
    /^(?:html|:root(?:\[data-theme="[a-z][a-z0-9-]*"\])?|html\[data-text-size(?:="[a-z]+")?\])$/;
  const out: string[] = [];
  for (const rule of themes.rules(css)) {
    if (!token.test(rule.selector)) continue;
    if (rule.at.some((a) => !a.includes("prefers-color-scheme"))) continue;
    const body = rule.declarations.map((d) => `${d.property}: ${d.value};`).join(" ");
    let text = `${rule.selector} { ${body} }`;
    for (const at of [...rule.at].reverse()) text = `${at} { ${text} }`;
    out.push(text);
  }
  return out.join("\n") + "\n";
}

// The proposals: one stylesheet per proposal in assets/proposals/, served
// as one sheet, in name order. None of it is Oriel's yet.
export function proposalsCss(): string {
  const dir = join(root, "assets/proposals");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => `/* --- assets/proposals/${f} --- */\n${readFileSync(join(dir, f), "utf8")}`)
    .join("\n");
}
