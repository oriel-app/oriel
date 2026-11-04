import { readFileSync } from "node:fs";
import { figures } from "./src/noticed/run.ts";
import { signalsOf } from "@oriel/server/signals";
import { loadFixtures } from "./src/fixtures.ts";
import { loadNoticedCases } from "./src/noticed/case.ts";
import { buildNoticedWorld } from "./src/noticed/world.ts";
const round = process.argv[2];
const trials = readFileSync(new URL(`../../.evals/noticed/${round}/trials.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const fixtures = loadFixtures();
const cases = new Map(loadNoticedCases().map((c) => [c.id, c]));
let pass = 0, grounded = 0, claims = 0, badClaims = 0;
const examples: string[] = [];
for (const t of trials) {
  const c = cases.get(t.id)!;
  const w = await buildNoticedWorld(c, fixtures);
  const byId = new Map(signalsOf(w.input).map((s) => [s.id, s]));
  const shown = new Set<string>();
  let ok = true;
  for (const line of t.text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let p: any; try { p = JSON.parse(line); } catch { continue; }
    const id = `${p.kind}:${p.about}`; shown.add(id); claims++;
    const stated = new Set(figures(byId.get(id)?.headline ?? ""));
    const made = figures(p.claim ?? "").filter((n: string) => !stated.has(n));
    if (made.length) { ok = false; badClaims++; if (examples.length < 6) examples.push(`${t.id}: ${p.claim} [${made}] vs Oriel: ${byId.get(id)?.headline ?? "(no signal)"}`); }
  }
  const find = c.expect.find.map(w.signalId).every((id) => shown.has(id));
  const avoid = c.expect.avoid.map(w.signalId).every((id) => !shown.has(id));
  if (ok) grounded++;
  if (ok && find && avoid && shown.size <= 4) pass++;
  w.close();
}
console.log({ trials: trials.length, pass, grounded, claims, badClaims });
console.log(examples.join("\n"));
