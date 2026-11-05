// What every theme must pass (decision 0034), judged on window.css itself:
//
// - Contrast. Every text token on every background, a state or `--derived`
//   on its own `-soft`, `--on-accent` on each fill it's written on, and what
//   the bead writes on its ink, is at least 4.5:1 (WCAG AA), in light and
//   dark.
// - The five states a PM scans for stay apart: any two differ by at least
//   10 in CIEDE2000, and by at least 4 under protanopia, deuteranopia and
//   tritanopia. The method is pinned: Machado 2009's matrices at full
//   strength in linear sRGB, then CIELAB under D65, then CIEDE2000 with
//   kL = kC = kH = 1.
// - Values, not rules. A theme block sets only theme tokens, and every
//   theme sets every colour token; shared tokens sit on `html`; no rule
//   outside a theme block selects on `data-theme`; and no rule writes a
//   literal colour, font family, weight, font size, radius (a dot's 50%
//   apart), border width, shadow or transition duration.
import {
  type Scheme,
  defaultTheme,
  resolve,
  rules,
  themeBlock,
  themeNames,
  tokens,
} from "../packages/web/themes.ts";

// --- Colour -------------------------------------------------------------

// sRGB, each channel 0 to 1, gamma-encoded, with alpha.
export type Rgba = [number, number, number, number];

const named: Record<string, Rgba> = {
  white: [1, 1, 1, 1],
  black: [0, 0, 0, 1],
  transparent: [0, 0, 0, 0],
};

// Top-level comma-separated arguments of a function's text.
function args(text: string): string[] {
  const out = [""];
  let depth = 0;
  for (const c of text) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) out.push("");
    else out[out.length - 1] += c;
  }
  return out.map((a) => a.trim());
}

// A colour as the browser computes it: hex, `rgb()`, a few names, and
// `color-mix()` in srgb, interpolated with premultiplied alpha.
export function parseColor(text: string): Rgba {
  const value = text.trim().toLowerCase();
  const name = named[value];
  if (name !== undefined) return name;
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const channel = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    if (full.length !== 6 && full.length !== 8) throw new Error(`Not a colour: ${text}`);
    return [channel(0), channel(1), channel(2), full.length === 8 ? channel(3) : 1];
  }
  const rgb = /^rgba?\((.*)\)$/.exec(value)?.[1];
  if (rgb !== undefined) {
    const [channels = "", alpha] = rgb.split("/");
    const parts = channels.split(/[\s,]+/).filter(Boolean);
    const a = alpha ?? (parts.length === 4 ? parts.pop() : undefined);
    const number = (p: string, scale: number) =>
      p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / scale;
    const [r, g, b, ...rest] = parts;
    if (r === undefined || g === undefined || b === undefined || rest.length > 0)
      throw new Error(`Not a colour: ${text}`);
    return [
      number(r, 255),
      number(g, 255),
      number(b, 255),
      a === undefined ? 1 : number(a.trim(), 1),
    ];
  }
  const mix = /^color-mix\((.*)\)$/.exec(value)?.[1];
  if (mix !== undefined) {
    const [space, first, second, ...rest] = args(mix);
    if (space !== "in srgb" || first === undefined || second === undefined || rest.length > 0)
      throw new Error(`Not an srgb mix: ${text}`);
    const weighed = (c: string): [Rgba, number | null] => {
      const percent = /(?:^|\s)(-?[\d.]+)%(?=\s|$)/.exec(c);
      if (percent === null) return [parseColor(c), null];
      return [parseColor(c.replace(percent[0], " ")), parseFloat(percent[1] ?? "") / 100];
    };
    const [a, p] = weighed(first);
    const [b, q] = weighed(second);
    const p1 = p ?? (q === null ? 0.5 : 1 - q);
    const p2 = q ?? 1 - p1;
    const sum = p1 + p2;
    if (sum <= 0) throw new Error(`A mix of nothing: ${text}`);
    const [w1, w2] = [p1 / sum, p2 / sum];
    const alpha = a[3] * w1 + b[3] * w2;
    const channel = (i: 0 | 1 | 2) =>
      alpha === 0 ? 0 : (a[i] * a[3] * w1 + b[i] * b[3] * w2) / alpha;
    return [channel(0), channel(1), channel(2), alpha * Math.min(sum, 1)];
  }
  throw new Error(`Not a colour Oriel's check reads: ${text}`);
}

// A colour as the screen paints it: 8 bits a channel, as the spike read
// every mix.
export function painted(c: Rgba): Rgba {
  return [
    Math.round(c[0] * 255) / 255,
    Math.round(c[1] * 255) / 255,
    Math.round(c[2] * 255) / 255,
    c[3],
  ];
}

// `fg` drawn over the opaque `bg`.
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  const channel = (i: 0 | 1 | 2) => fg[i] * a + bg[i] * (1 - a);
  return [channel(0), channel(1), channel(2), 1];
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// WCAG 2's contrast ratio.
export function contrast(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Lab = [number, number, number];

// Linear sRGB to CIELAB under D65.
function lab([r, g, b]: [number, number, number]): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// CIEDE2000, kL = kC = kH = 1 (Sharma, Wu and Dalal 2005).
export function ciede2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hBar /= 2;
    else hBar = hp1 + hp2 < 360 ? (hBar + 360) / 2 : (hBar - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBar;
  const sh = 1 + 0.015 * cBar * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

export type Vision = "typical" | "protanopia" | "deuteranopia" | "tritanopia";

// Machado, Oliveira and Fernandes 2009, severity 1.0, on linear sRGB.
type Row = [number, number, number];
const machado: Record<Exclude<Vision, "typical">, [Row, Row, Row]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

// How far apart two opaque colours look, to `vision`.
export function distance(a: Rgba, b: Rgba, vision: Vision = "typical"): number {
  const seen = (c: Rgba): Lab => {
    const rgb: Row = [linear(c[0]), linear(c[1]), linear(c[2])];
    if (vision === "typical") return lab(rgb);
    const simulated = ([r, g, b]: Row) =>
      Math.min(1, Math.max(0, r * rgb[0] + g * rgb[1] + b * rgb[2]));
    const [x, y, z] = machado[vision];
    return lab([simulated(x), simulated(y), simulated(z)]);
  };
  return ciede2000(seen(a), seen(b));
}

// --- The rules ----------------------------------------------------------

export const textTokens = [
  "--text",
  "--text-muted",
  "--text-faint",
  "--accent",
  "--todo",
  "--in-progress",
  "--done",
  "--danger",
  "--derived",
  "--del",
];
export const backgrounds = ["--bg", "--surface", "--surface-hover", "--surface-sunk", "--list-bg"];
// Each drawn on its own `-soft`.
export const onSoft = ["--accent", "--todo", "--in-progress", "--done", "--danger", "--derived"];
// The fills `--on-accent` is written on.
export const onAccent = ["--accent", "--done", "--danger"];
// What the bead writes on its ink (decision 0056).
export const onBead = [
  "--bead-text",
  "--bead-faint",
  "--bead-accent",
  "--bead-working",
  "--bead-done",
  "--bead-danger",
];
// The five states a PM scans for: your move, in progress, an error or a
// stall, done, and an Oriel rule.
export const scanned = ["--accent", "--in-progress", "--danger", "--done", "--derived"];

export const minContrast = 4.5;
export const minDistance = 10;
export const minSimulated = 4;

// The tokens a theme sets, and no other block may. Colour ones are set by
// every theme.
export const colourTokens = [
  "--bg",
  "--surface",
  "--surface-hover",
  "--surface-sunk",
  "--line",
  "--line-strong",
  "--text",
  "--text-muted",
  "--text-faint",
  "--accent",
  "--on-accent",
  "--todo",
  "--in-progress",
  "--done",
  "--danger",
  "--derived",
  "--del",
  "--tint",
  "--list-bg",
  "--type-story",
  "--type-bug",
  "--type-task",
  "--type-epic",
  "--type-other",
  "--avatar",
  "--avatar-text",
  "--bead",
];
export const themeTokens = [
  ...colourTokens,
  "--font",
  "--font-mono",
  "--font-heading",
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
  "--section-rule",
  "--section-head-font",
  "--section-head-case",
  "--section-head-tracking",
  "--list-frame",
  "--row",
  "--row-pad",
  "--ask-mark",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-6",
  "--space-8",
  "--radius-sm",
  "--radius",
  "--radius-lg",
  "--bead-radius",
  "--border-thin",
  "--border-thick",
  "--shadow-sm",
  "--shadow",
  "--duration-quick",
  "--duration-move",
  "--duration-morph",
  "--ease-out",
  "--ease-spring",
];

const schemes: Scheme[] = ["light", "dark"];
const fixed = (n: number) => n.toFixed(2);

// A colour token as `theme` paints it in `scheme`.
export function themeColour(css: string, theme: string, scheme: Scheme, name: string): Rgba {
  const values = tokens(css, theme, scheme);
  const value = values.get(name);
  if (value === undefined) throw new Error(`${name} has no value in ${theme}, ${scheme}`);
  return painted(parseColor(resolve(value, values)));
}

// Contrast and states, for one theme in one scheme.
export function colourProblems(css: string, theme: string, scheme: Scheme): string[] {
  const where = `${theme}, ${scheme}`;
  const found: string[] = [];
  const colour = (name: string) => themeColour(css, theme, scheme, name);
  const soft = (name: string) => `${name}-soft`;
  const pairs: [string, string][] = [
    ...textTokens.flatMap((fg) => backgrounds.map((bg): [string, string] => [fg, bg])),
    ...onSoft.map((fg): [string, string] => [fg, soft(fg)]),
    ...onAccent.map((bg): [string, string] => ["--on-accent", bg]),
    ...onBead.map((fg): [string, string] => [fg, "--bead"]),
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(colour(fg), colour(bg));
    if (ratio < minContrast)
      found.push(`${where}: ${fg} on ${bg} is ${fixed(ratio)}:1, under ${minContrast}:1`);
  }
  const visions: [Vision, number][] = [
    ["typical", minDistance],
    ["protanopia", minSimulated],
    ["deuteranopia", minSimulated],
    ["tritanopia", minSimulated],
  ];
  for (const [i, a] of scanned.entries())
    for (const b of scanned.slice(i + 1))
      for (const [vision, least] of visions) {
        const d = distance(colour(a), colour(b), vision);
        if (d < least)
          found.push(
            `${where}: ${a} and ${b} are ${fixed(d)} apart in CIEDE2000${vision === "typical" ? "" : ` under ${vision}`}, under ${least}`,
          );
      }
  return found;
}

const colourWord = new RegExp(
  `#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${[
    "white",
    "black",
    "red",
    "green",
    "blue",
    "gray",
    "grey",
    "silver",
    "orange",
    "yellow",
    "purple",
  ].join("|")})\\b`,
  "i",
);
const length = /(?:^|[\s(,/])-?(?:\d*\.)?\d+(?:px|rem|em|%|pt|ch|vw|vh)?(?=$|[\s),/])/;
const duration = /(?:^|[\s,])(?:\d*\.)?\d+m?s\b/g;
const fontWeight = /(?:^|\s)(?:[1-9]00|bold|bolder|lighter|normal)(?=\s|$)/;

const withoutVars = (value: string) => {
  let out = value;
  for (let last = ""; last !== out;) {
    last = out;
    out = out.replace(/var\([^()]*\)/g, " ");
  }
  return out;
};

// A colour's mix, say, has percentages that aren't widths.
const withoutCalls = (value: string) => {
  let out = value;
  for (let last = ""; last !== out;) {
    last = out;
    out = out.replace(/[a-z-]+\([^()]*\)/g, " ");
  }
  return out;
};

const wide = new Set(["inherit", "initial", "unset", "none", "0", "transparent", "currentcolor"]);

// What's literal in one declaration of a rule, if anything.
export function literal(property: string, value: string): string | null {
  const bare = withoutVars(value).trim();
  const plain = bare.replace(/\s+/g, " ").toLowerCase();
  if (property.startsWith("--")) {
    // A component's own property: judge it by what it stands for.
    return colourWord.test(bare) ? "a literal colour" : null;
  }
  if (colourWord.test(bare.replace(/url\([^)]*\)/g, ""))) return "a literal colour";
  if (property === "font-family")
    return wide.has(plain) || plain === "" ? null : "a literal font family";
  if (property === "font-weight")
    return wide.has(plain) || plain === "" ? null : "a literal weight";
  if (property === "font-size")
    return wide.has(plain) || plain === "" ? null : "a literal font size";
  if (property === "font") {
    if (wide.has(plain) || plain === "") return null;
    if (fontWeight.test(plain)) return "a literal weight";
    // What follows a slash is the line height, which no theme reaches.
    const rest = plain.replace(/\/\s*\S*/, " ").trim();
    if (rest === "") return null;
    if (length.test(rest)) return "a literal font size";
    return "a literal font family";
  }
  if (/^border(?:-[a-z]+)*-radius$/.test(property)) {
    const parts = plain.split(/[\s/]+/).filter(Boolean);
    return parts.every((p) => wide.has(p) || p === "50%") ? null : "a literal radius";
  }
  if (
    /^(?:border|outline)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?$/.test(
      property,
    )
  ) {
    const lengths = withoutCalls(plain)
      .split(/\s+/)
      .filter((p) => length.test(p) && p !== "0");
    return lengths.length > 0 ? "a literal border width" : null;
  }
  if (property === "box-shadow" || property === "text-shadow") {
    if (wide.has(plain) || plain === "") return null;
    // A token's shadow, or a ring: no offset or blur, and a border token's
    // spread. A ring with a literal spread has a literal border width.
    let what: string | null = null;
    for (const shadow of args(value)) {
      const lengths = withoutVars(shadow)
        .trim()
        .split(/\s+/)
        .filter((p) => p !== "" && p !== "inset");
      if (lengths.length <= 3 && lengths.every((p) => p === "0")) continue;
      const ring = lengths.length === 4 && lengths.slice(0, 3).every((p) => p === "0");
      what ??= ring ? "a literal border width" : "a literal shadow";
    }
    return what;
  }
  if (property === "transition" || property === "transition-duration") {
    const durations = plain.match(duration) ?? [];
    return durations.some((d) => parseFloat(d.trim()) !== 0)
      ? "a literal transition duration"
      : null;
  }
  return null;
}

// Values, not rules, over every rule in `css`.
export function ruleProblems(css: string): string[] {
  const found: string[] = [];
  const all = rules(css);
  const themeSet = new Set(themeTokens);
  const colourSet = new Set(colourTokens);
  const set = new Map<string, Map<Scheme, Set<string>>>();
  for (const rule of all) {
    const block = themeBlock(rule);
    if (block === null) {
      if (/data-theme/.test(rule.selector) || rule.at.some((a) => /data-theme/.test(a)))
        found.push(
          `window.css:${rule.line}: ${rule.selector} selects on data-theme outside a theme block`,
        );
      if (/^:root\b/.test(rule.selector))
        found.push(
          `window.css:${rule.line}: a :root block that isn't a theme's; shared tokens sit on html`,
        );
      for (const { property, value, line } of rule.declarations) {
        if (themeSet.has(property) && !/keyframes/.test(rule.at.join()))
          found.push(
            `window.css:${line}: ${rule.selector} sets ${property}, a theme token, outside a theme block`,
          );
        const what = literal(property, value);
        if (what !== null && !/@keyframes/.test(rule.at.join()))
          found.push(`window.css:${line}: ${rule.selector} has ${what} in ${property}: ${value}`);
      }
      continue;
    }
    for (const { property, value, line } of block.rule.declarations) {
      if (block.theme === "") {
        if (themeSet.has(property))
          found.push(
            `window.css:${line}: html sets ${property}, a theme token; it belongs in a theme block`,
          );
        const what = literal(property, value);
        if (what !== null)
          found.push(`window.css:${line}: html has ${what} in ${property}: ${value}`);
        continue;
      }
      if (!themeSet.has(property))
        found.push(
          `window.css:${line}: ${rule.selector} sets ${property}, which isn't a theme token${property.startsWith("--") ? "" : " (a shared property sits on html)"}`,
        );
      const byScheme = set.get(block.theme) ?? new Map<Scheme, Set<string>>();
      set.set(block.theme, byScheme);
      const names = byScheme.get(block.scheme) ?? new Set<string>();
      byScheme.set(block.scheme, names);
      names.add(property);
    }
  }
  // Every token resolves in every theme and scheme: none names itself, or
  // a token nothing sets.
  for (const theme of themeNames(css))
    for (const scheme of schemes) {
      const values = tokens(css, theme, scheme);
      for (const [name, value] of values)
        try {
          resolve(value, values, new Set([name]));
        } catch (error) {
          found.push(`window.css: ${theme}, ${scheme}: ${name}: ${(error as Error).message}`);
        }
    }
  const defaults = set.get(defaultTheme);
  for (const theme of themeNames(css)) {
    const own = set.get(theme);
    const light = own?.get("light") ?? new Set<string>();
    const dark = own?.get("dark") ?? new Set<string>();
    for (const name of colourTokens) {
      if (!light.has(name)) found.push(`window.css: ${theme} doesn't set ${name}`);
      else if (!dark.has(name) && literalIn(css, theme, name))
        found.push(`window.css: ${theme} sets ${name} in light but not in dark`);
    }
    if (theme === defaultTheme) continue;
    // A token the default sets per scheme, a theme sets in both or neither.
    for (const name of defaults?.get("dark") ?? [])
      if (!colourSet.has(name) && light.has(name) !== dark.has(name))
        found.push(
          `window.css: ${theme} sets ${name} in one scheme; the default sets it per scheme`,
        );
  }
  return found;
}

// Whether `theme`'s light value of `name` is written with a colour of its
// own, rather than derived from other tokens, so dark needs its own value.
function literalIn(css: string, theme: string, name: string): boolean {
  for (const rule of rules(css)) {
    const block = themeBlock(rule);
    if (block?.theme !== theme || block.scheme !== "light") continue;
    const value = rule.declarations.find((d) => d.property === name)?.value;
    if (value !== undefined)
      return !/^(?:color-mix\(|var\()/.test(value.trim()) || colourWord.test(withoutVars(value));
  }
  return false;
}

// Every problem with window.css's themes.
export function themeProblems(css: string): string[] {
  const found = ruleProblems(css);
  if (found.length > 0) return found;
  for (const theme of themeNames(css))
    for (const scheme of schemes) found.push(...colourProblems(css, theme, scheme));
  return found;
}
