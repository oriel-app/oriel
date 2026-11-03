// The direction's colour pairs and their WCAG contrast, read from the
// tokens in window.css, in light and in dark. A spike's tool: run it with
// `node spike/visual/d2/contrast.ts`.
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../../../packages/web/assets/window.css", import.meta.url),
  "utf8",
);
const block = (from: number) => {
  const start = css.indexOf("{", from) + 1;
  let depth = 1;
  let at = start;
  while (depth > 0) {
    if (css[at] === "{") depth++;
    if (css[at] === "}") depth--;
    at++;
  }
  return css.slice(start, at - 1);
};
const tokens = (text: string) =>
  new Map([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const light = tokens(block(css.indexOf(":root")));
const dark = new Map([
  ...light,
  ...tokens(block(css.indexOf(":root", css.indexOf("prefers-color-scheme: dark")))),
]);

const resolve = (theme: Map<string, string>, name: string): string => {
  let value = theme.get(name) ?? "";
  for (let i = 0; i < 8; i++) {
    const ref = value.match(/^var\(--([a-z0-9-]+)\)$/);
    if (!ref) break;
    value = theme.get(ref[1]!) ?? "";
  }
  return value;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const pairs: [string, string][] = JSON.parse(process.argv[2] ?? "null") ?? [
  ...["n-7", "n-6", "n-5"].flatMap((text) =>
    ["n-0", "n-1", "n-2"].map((bg) => [text, bg] as [string, string]),
  ),
  ["on-accent", "accent"],
  ["accent", "n-0"],
  ["accent", "n-1"],
  ["accent", "accent-soft"],
  ...["todo", "progress", "done", "needs", "stalled", "applied", "reverted"].flatMap((state) => [
    [`state-${state}`, "n-0"] as [string, string],
    [`state-${state}`, "n-1"] as [string, string],
    [`state-${state}`, `state-${state}-soft`] as [string, string],
  ]),
];
let worst = Infinity;
console.log("| text | on | light | dark |\n| --- | --- | --- | --- |");
for (const [text, bg] of pairs) {
  const cells = [light, dark].map((theme) => {
    const value = ratio(resolve(theme, text), resolve(theme, bg));
    worst = Math.min(worst, value);
    return `${value.toFixed(1)}${value < 4.5 ? " ✗" : ""}`;
  });
  console.log(`| ${text} | ${bg} | ${cells.join(" | ")} |`);
}
console.log(`\nworst: ${worst.toFixed(2)}`);
