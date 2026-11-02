// Spike: the judged half of TASKS.md. `prep` copies each candidate's
// screenshots under a shuffled label and writes one prompt per judge; the
// judges (fresh subagents) write their answers as JSON; `grade` scores them
// against the world's truth.
//
// node scripts/explore/judge.ts prep <round> <design...>
// node scripts/explore/judge.ts grade <round>
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { truth, type Truth, world } from "./world.ts";

const root = "/tmp/oriel-judge";
const shots = "/tmp/wx";
const views = [
  ["large", "laptop", 1280],
  ["large", "narrow", 600],
  ["medium", "laptop", 1280],
] as const;

type Task = "t1" | "t2" | "t3" | "t4" | "t6" | "t7";
const tasks = (t: Truth): Record<Task, { ask: string; shape: string }> => ({
  t1: {
    ask: "How many threads are waiting on you right now, and which one has waited the longest?",
    shape: '{"count": number or null, "longest": "thread title" or null}',
  },
  t2: {
    ask: "Since you last looked, which workstream had the most of its items change, and how many of its items changed?",
    shape: '{"workstream": "name" or null, "count": number or null}',
  },
  t3: {
    ask: "Which open workstream looks stalled: nothing has moved in it for the longest time?",
    shape: '{"workstream": "name" or null}',
  },
  t4: {
    ask: "What is the most important thing that isn't in any workstream yet? Name it, and the source it comes from.",
    shape: '{"name": "its name" or null, "source": "source name" or null}',
  },
  t6: {
    ask: `What is ${t.t6.person} working on right now: how many items does ${t.t6.person} have in progress, and in which workstream are most of them?`,
    shape: '{"count": number or null, "workstream": "name" or null}',
  },
  t7: {
    ask: "Which item is the team's chat talking about most this week?",
    shape: '{"item": "its key or title" or null}',
  },
});

const letters = "MDQAKTHPWCRB";

function prep(round: string, designs: string[]) {
  const dir = `${root}/${round}`;
  mkdirSync(`${dir}/answers`, { recursive: true });
  // One label per design for the whole spike, from a shuffled alphabet, so a
  // label says nothing about which design is newest.
  const global = `${root}/labels.json`;
  const labels: Record<string, string> = existsSync(global)
    ? (JSON.parse(readFileSync(global, "utf8")) as Record<string, string>)
    : {};
  for (const d of designs) labels[d] ??= letters[Object.keys(labels).length] ?? `Z${d}`;
  writeFileSync(global, JSON.stringify(labels, null, 1));
  writeFileSync(`${dir}/labels.json`, JSON.stringify(labels, null, 1));
  const prompts: { id: string; prompt: string }[] = [];
  for (const design of designs) {
    const label = labels[design] ?? "";
    for (const [scale, width, px] of views) {
      const t = truth(world(scale));
      const files: string[] = [];
      for (let i = 1; i <= 4; i += 1) {
        const from = `${shots}/${design}/${scale}-${width}-${i}.png`;
        if (!existsSync(from)) break;
        const to = `${dir}/${label}/${scale}-${width}-${i}.png`;
        mkdirSync(`${dir}/${label}`, { recursive: true });
        copyFileSync(from, to);
        files.push(to);
      }
      for (const [task, { ask, shape }] of Object.entries(tasks(t))) {
        const id = `${label}-${scale}-${width}-${task}`;
        prompts.push({
          id,
          prompt: [
            "You're helping test how well a screen design of a work-tracking app answers a user's question. You see only screenshots.",
            `Read these image files with the Read tool, and nothing else. Don't open, list or search any other file or folder, and don't run commands:\n${files.join("\n")}`,
            `They show the app's first screen at a window ${px}px wide, then up to three more screens as the page scrolls down.`,
            `Answer as a user would, from what the screenshots show. The question: ${ask}`,
            "If the screenshots don't show enough to answer, use null rather than guessing.",
            `Write your answer as JSON to ${dir}/answers/${id}.json, in this shape: ${shape.slice(0, -1)}, "confidence": 0 to 100, "where": "a few words on where you found it"}`,
            "Then reply with the same JSON and nothing else.",
          ].join("\n\n"),
        });
      }
    }
  }
  writeFileSync(`${dir}/prompts.json`, JSON.stringify(prompts, null, 1));
  console.log(`${prompts.length} prompts in ${dir}/prompts.json`, labels);
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
const same = (answer: unknown, truths: readonly string[]) => {
  const a = norm(answer);
  return (
    a.length >= 3 &&
    truths.some((t) => {
      const n = norm(t);
      return n.length > 0 && (a.includes(n) || n.includes(a));
    })
  );
};

function score(task: Task, a: Record<string, unknown>, t: Truth): number {
  switch (task) {
    case "t1":
      return (
        (Number(a["count"]) === t.t1.count ? 0.5 : 0) + (same(a["longest"], t.t1.oldest) ? 0.5 : 0)
      );
    case "t2":
      return (
        (same(a["workstream"], t.t2.workstreams) ? 0.5 : 0) +
        (Number(a["count"]) === t.t2.count ? 0.5 : 0)
      );
    case "t3":
      return same(a["workstream"], t.t3.workstreams) ? 1 : 0;
    case "t4":
      return (
        (same(a["name"], t.t4.names) || same(a["name"], [t.t4.key]) ? 0.5 : 0) +
        (same(a["source"], [t.t4.source]) ? 0.5 : 0)
      );
    case "t6":
      return (
        (Number(a["count"]) === t.t6.count ? 0.5 : 0) +
        (same(a["workstream"], t.t6.workstreams) ? 0.5 : 0)
      );
    case "t7":
      return same(a["item"], [...t.t7.keys, ...t.t7.titles]) ? 1 : 0;
  }
}

function grade(round: string) {
  const dir = `${root}/${round}`;
  const labels = JSON.parse(readFileSync(`${dir}/labels.json`, "utf8")) as Record<string, string>;
  const byLabel = Object.fromEntries(Object.entries(labels).map(([d, l]) => [l, d]));
  const truths = { large: truth(world("large")), medium: truth(world("medium")) };
  const results: Record<
    string,
    { total: number; n: number; byTask: Record<string, number>; rows: string[] }
  > = {};
  for (const file of readdirSync(`${dir}/answers`).toSorted()) {
    const [label, scale, width, task] = file.replace(/\.json$/, "").split("-") as [
      string,
      "large" | "medium",
      string,
      Task,
    ];
    const design = byLabel[label] ?? label;
    let a: Record<string, unknown>;
    try {
      a = JSON.parse(readFileSync(`${dir}/answers/${file}`, "utf8")) as Record<string, unknown>;
    } catch {
      a = {};
    }
    const s = score(task, a, truths[scale]);
    const r = (results[design] ??= { total: 0, n: 0, byTask: {}, rows: [] });
    r.total += s;
    r.n += 1;
    r.byTask[task] = (r.byTask[task] ?? 0) + s;
    r.rows.push(
      `${scale}-${width} ${task} ${s} conf ${a["confidence"]} ${JSON.stringify(a).slice(0, 160)}`,
    );
  }
  writeFileSync(`${dir}/graded.json`, JSON.stringify(results, null, 1));
  for (const [design, r] of Object.entries(results)) {
    console.log(`${design} (${labels[design]}): answered ${r.total} of ${r.n}`, r.byTask);
    for (const row of r.rows) console.log("  ", row);
  }
}

const [cmd, round, ...rest] = process.argv.slice(2);
if (cmd === "prep" && round) prep(round, rest);
else if (cmd === "grade" && round) grade(round);
else console.log("prep <round> <design...> | grade <round>");
