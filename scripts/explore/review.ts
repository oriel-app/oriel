// Spike: one fresh design reviewer per round, with TASKS.md's rubric. It sees
// the candidate's and the current best's screenshots under their labels.
// node scripts/explore/review.ts <round> <design...>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [round, ...args] = process.argv.slice(2);
// Rounds 10 on (TASKS2.md): the large world, and each asking task's screen.
const asking = args.includes("--asks");
const designs = args.filter((a) => a !== "--asks");
const labels = JSON.parse(readFileSync("/tmp/oriel-judge/labels.json", "utf8")) as Record<
  string,
  string
>;
const dir = `/tmp/oriel-judge/${round}/review`;
mkdirSync(dir, { recursive: true });
const lines: string[] = [];
for (const design of designs) {
  const label = labels[design];
  lines.push(`Design ${label}:`);
  for (const scale of asking ? ["large"] : ["fixtures", "medium", "large"])
    for (const width of ["laptop", "narrow"])
      for (const i of asking ? ["1", "2", "a1", "a2", "a4", "a5", "a3"] : ["1", "2"]) {
        const from = `/tmp/wx/${design}/${scale}-${width}-${i}.png`;
        if (!existsSync(from)) continue;
        const to = `${dir}/${label}-${scale}-${width}-${i}.png`;
        copyFileSync(from, to);
        lines.push(to);
      }
}
const prompt = `You're a product designer reviewing screen designs for the home page of a work-tracking tool for product managers. It shows their workstreams (sets of items they curate from many sources: trackers, chat, docs, code, support), threads with an assistant that wait on them, what changed since they last looked, and what isn't in any workstream yet.

${asking ? `It also has a chat for asking about all of it ("Ask about your window"); its answers are computed, and can be pinned to the home page. Each design is shown on the large data size (~4,000 items, 10 sources, 40 workstreams) at a laptop width (1280px) and a narrow window (600px): the first screen and the next screen down (named -1, -2), then the screen right after each of these: a1, asking which sources changed most (a table); a2, asking for a chart of what moved by workstream; a4, that chart pinned to the home page, seen on the next visit; a5, asking about a stalled workstream, cited from its row; a3, making a workstream of the top thing not in one. A design without a chat has no a1, a2, a4 or a5 screens.` : ""}

${asking ? "" : "Each design is shown in three data sizes (fixtures: tiny; medium: ~600 items, 5 sources, 12 workstreams; large: ~4,000 items, 10 sources, 40 workstreams), at a laptop width (1280px) and a narrow window (600px), as the first screen and the next screen down."}

Read these image files with the Read tool, and nothing else. Don't open, list or search any other file or folder, and don't run commands:

${lines.join("\n")}

Score each design 1 to 5 on each of these, with one sentence each:
1. Scanning: can the eye find "what needs me" and "what changed" in two seconds?
2. Hierarchy: is the most important thing the most prominent?
3. Density: is the space used for information rather than chrome, without crowding?
4. Consistency: do like things look alike (rows, counts, states, sources)?
5. Growth: what grows badly as sources reach 10 and workstreams 40 (or 400)?
${asking ? "6. Asking: is it clear where to ask, are answers (tables, charts) readable at a glance, and are they clearly set apart from the home page's own facts?\n" : ""}
Then name the single change that would most improve each design. Write it all as JSON to ${dir}/review.json in this shape: {"<label>": {"scanning": [score, "sentence"], "hierarchy": [...], "density": [...], "consistency": [...], "growth": [...],${asking ? ' "asking": [...],' : ""} "change": "sentence"}}, and reply with the same JSON.`;
writeFileSync(`${dir}/prompt.txt`, prompt);
console.log(
  `${dir}/prompt.txt`,
  designs.map((d) => labels[d]),
);
