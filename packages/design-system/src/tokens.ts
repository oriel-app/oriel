import { check, type Scheme, themes, windowCss } from "./oriel.ts";

export const schemes: Scheme[] = ["light", "dark"];

export type Pair = {
  fg: string;
  bg: string;
  kind: "text" | "soft" | "on-fill" | "non-text" | "line";
  min: number;
  claimed: boolean;
};

export function pairs(): Pair[] {
  const text = check.textTokens.flatMap((fg) =>
    check.backgrounds.map((bg): Pair => ({
      fg,
      bg,
      kind: "text",
      min: check.minContrast,
      claimed: true,
    })),
  );
  const soft = check.onSoft.map((fg): Pair => ({
    fg,
    bg: `${fg}-soft`,
    kind: "soft",
    min: check.minContrast,
    claimed: true,
  }));
  const onFill = check.onAccent.map((bg): Pair => ({
    fg: "--on-accent",
    bg,
    kind: "on-fill",
    min: check.minContrast,
    claimed: true,
  }));
  const nonText = ["--focus", "--accent"].flatMap((fg) =>
    check.backgrounds.map((bg): Pair => ({ fg, bg, kind: "non-text", min: 3, claimed: true })),
  );
  const lines = ["--line-strong", "--line"].flatMap((fg) =>
    ["--bg", "--surface"].map((bg): Pair => ({ fg, bg, kind: "line", min: 3, claimed: false })),
  );
  return [...text, ...soft, ...onFill, ...nonText, ...lines];
}

export type Judged = Pair & { theme: string; scheme: Scheme; ratio: number; passes: boolean };

export function judge(css = windowCss()): Judged[] {
  const out: Judged[] = [];
  for (const theme of themes.themeNames(css))
    for (const scheme of schemes) {
      const colour = (name: string) => check.themeColour(css, theme, scheme, name);
      for (const pair of pairs()) {
        const ratio = check.contrast(colour(pair.fg), colour(pair.bg));
        out.push({ ...pair, theme, scheme, ratio, passes: ratio >= pair.min });
      }
    }
  return out;
}

export function value(css: string, theme: string, scheme: Scheme, name: string): string {
  const values = themes.tokens(css, theme, scheme);
  const raw = values.get(name);
  if (raw === undefined) return "";
  try {
    return themes.resolve(raw, values);
  } catch {
    return raw;
  }
}

export function hex(css: string, theme: string, scheme: Scheme, name: string): string {
  const [r, g, b, a] = check.themeColour(css, theme, scheme, name);
  const byte = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
}

export const groups: Record<string, string[]> = {
  type: [
    "--font",
    "--font-heading",
    "--font-mono",
    "--title-weight",
    "--text-xs",
    "--text-sm",
    "--text-md",
    "--text-lg",
    "--text-xl",
    "--weight-regular",
    "--weight-medium",
    "--weight-strong",
    "--leading-tight",
    "--leading",
    "--leading-prose",
    "--section-head-font",
    "--section-head-case",
    "--section-head-tracking",
  ],
  space: [
    "--space-1",
    "--space-2",
    "--space-3",
    "--space-4",
    "--space-6",
    "--space-8",
    "--row",
    "--row-pad",
  ],
  shape: [
    "--radius-sm",
    "--radius",
    "--radius-lg",
    "--border-thin",
    "--border-thick",
    "--section-rule",
    "--list-frame",
    "--list-bg",
  ],
  elevation: ["--shadow-sm", "--shadow", "--scrim"],
  motion: ["--duration-quick", "--duration-move", "--ease-out"],
  layout: [
    "--page",
    "--rail",
    "--chat",
    "--chat-rail",
    "--sidebar",
    "--panel",
    "--beside",
    "--bar-height",
    "--inset-top",
    "--head-row",
    "--slide-panel",
  ],
  frame: [
    "--frame",
    "--frame-shade",
    "--frame-corner",
    "--frame-corner-narrow",
    "--frame-band",
    "--frame-curve",
    "--frame-top",
    "--frame-shadow",
    "--frame-room",
    "--layer-frame",
    "--bead-radius",
    "--bead-seed",
    "--bead-height",
    "--bead-neck",
    "--bead-gap",
    "--bead-swell",
  ],
  derived: [
    "--accent-soft",
    "--todo-soft",
    "--in-progress-soft",
    "--done-soft",
    "--danger-soft",
    "--derived-soft",
    "--derived-line",
    "--focus",
    "--ins",
    "--ins-soft",
    "--handed-off",
    "--handed-off-soft",
    "--sidebar-bg",
    "--scrim",
  ],
};

export function breakpoints(css = windowCss()): { at: string; line: number; rules: number }[] {
  const out: { at: string; line: number; rules: number }[] = [];
  let last: string | undefined;
  for (const rule of themes.rules(css)) {
    const at = rule.at.find(
      (a) => /^@(media|container)/.test(a) && !/prefers-color-scheme/.test(a),
    );
    const top = out.at(-1);
    if (at !== undefined && at === last && top) top.rules++;
    else if (at !== undefined) out.push({ at, line: rule.line, rules: 1 });
    last = at;
  }
  return out;
}

export function shared(css = windowCss()): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of themes.rules(css))
    if (rule.selector === "html")
      for (const d of rule.declarations)
        if (d.property.startsWith("--"))
          out.set(rule.at.length ? `${d.property} (${rule.at.join(" ")})` : d.property, d.value);
  return out;
}
