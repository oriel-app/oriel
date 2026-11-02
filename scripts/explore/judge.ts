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
import { type AskTruth, askTruth } from "./ask.ts";
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

const letters = "MDQAKTHPWCRBEFGJLN";

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

// Rounds 10 on (TASKS2.md): reading on the large world at both widths, with
// the chat present; and the asking tasks, each judged from the one screen the
// design's path ends on.
type Ask = "a1" | "a2" | "a3" | "a5";
const asks = (a: AskTruth): Record<Ask, { ask: string; shape: string }> => ({
  a1: {
    ask: "The user asked the assistant which sources changed most since they last looked. Which source had the second most items change, and how many items?",
    shape: '{"source": "name" or null, "count": number or null}',
  },
  a2: {
    ask: "The user asked for a chart of what moved since they last looked, by workstream. Which workstream had the second most items move, and how many items?",
    shape: '{"workstream": "name" or null, "count": number or null}',
  },
  a3: {
    ask: "The user just made a workstream of the most important thing that wasn't in any workstream yet. What is the new workstream called, and how many items does it hold?",
    shape: '{"name": "its name" or null, "size": number or null}',
  },
  a5: {
    ask: `The user asked why the workstream "${a.a5.workstream}" is stalled. Which item in it changed last, and how many days ago?`,
    shape: '{"item": "its key or title" or null, "days": number or null}',
  },
});

function prep2(round: string, designs: string[], only?: string) {
  const dir = `${root}/${round}`;
  mkdirSync(`${dir}/answers`, { recursive: true });
  mkdirSync(`${dir}/p`, { recursive: true });
  const global = `${root}/labels.json`;
  const labels: Record<string, string> = existsSync(global)
    ? (JSON.parse(readFileSync(global, "utf8")) as Record<string, string>)
    : {};
  for (const d of designs) labels[d] ??= letters[Object.keys(labels).length] ?? `Z${d}`;
  writeFileSync(global, JSON.stringify(labels, null, 1));
  writeFileSync(`${dir}/labels.json`, JSON.stringify(labels, null, 1));
  const w = world("large");
  const t = truth(w);
  const a = askTruth(w);
  const prompts: { id: string; prompt: string }[] = [];
  const say = (id: string, files: string[], px: number, what: string, ask: string, shape: string) =>
    prompts.push({
      id,
      prompt: [
        "You're helping test how well a screen design of a work-tracking app answers a user's question. You see only screenshots.",
        `Read these image files with the Read tool, and nothing else. Don't open, list or search any other file or folder, and don't run commands:\n${files.join("\n")}`,
        `They show ${what} at a window ${px}px wide.`,
        `Answer as a user would, from what the screenshots show. The question: ${ask}`,
        "If the screenshots don't show enough to answer, use null rather than guessing.",
        `Write your answer as JSON to ${dir}/answers/${id}.json, in this shape: ${shape.slice(0, -1)}, "confidence": 0 to 100, "where": "a few words on where you found it"}`,
        "Then reply with the same JSON and nothing else.",
      ].join("\n\n"),
    });
  for (const design of designs) {
    const label = labels[design] ?? "";
    mkdirSync(`${dir}/${label}`, { recursive: true });
    for (const [width, px] of [
      ["laptop", 1280],
      ["narrow", 600],
    ] as const) {
      const copy = (name: string) => {
        const from = `${shots}/${design}/large-${width}-${name}.png`;
        if (!existsSync(from)) return null;
        const to = `${dir}/${label}/large-${width}-${name}.png`;
        copyFileSync(from, to);
        return to;
      };
      if (only !== "asks") {
        const files = [1, 2, 3, 4].flatMap((i) => copy(`${i}`) ?? []);
        for (const [task, { ask, shape }] of Object.entries(tasks(t)))
          say(
            `${label}-large-${width}-${task}`,
            files,
            px,
            "the app's first screen, then up to three more screens as the page scrolls down,",
            ask,
            shape,
          );
      }
      for (const [task, { ask, shape }] of Object.entries(asks(a))) {
        const file = copy(task);
        if (!file) continue;
        say(
          `${label}-large-${width}-${task}`,
          [file],
          px,
          "the app's screen right after the user did what the question describes,",
          ask,
          shape,
        );
      }
    }
  }
  writeFileSync(`${dir}/prompts.json`, JSON.stringify(prompts, null, 1));
  for (const p of prompts) writeFileSync(`${dir}/p/${p.id}.txt`, p.prompt);
  console.log(`${prompts.length} prompts in ${dir}/p`, prompts.map((p) => p.id).join(" "));
}

function score2(task: string, x: Record<string, unknown>, t: Truth, a: AskTruth): number {
  const half = (ok: boolean) => (ok ? 0.5 : 0);
  switch (task) {
    case "a1":
      return half(same(x["source"], a.a1.sources)) + half(Number(x["count"]) === a.a1.count);
    case "a2":
      return (
        half(same(x["workstream"], a.a2.workstreams)) + half(Number(x["count"]) === a.a2.count)
      );
    case "a3":
      return half(same(x["name"], a.a3.names)) + half(Number(x["size"]) === a.a3.size);
    case "a5":
      return (
        half(same(x["item"], [...a.a5.keys, ...a.a5.titles])) +
        half(Number(x["days"]) === a.a5.days)
      );
    default:
      return score(task as Task, x, t);
  }
}

function grade2(round: string) {
  const dir = `${root}/${round}`;
  const labels = JSON.parse(readFileSync(`${dir}/labels.json`, "utf8")) as Record<string, string>;
  const byLabel = Object.fromEntries(Object.entries(labels).map(([d, l]) => [l, d]));
  const w = world("large");
  const t = truth(w);
  const a = askTruth(w);
  const results: Record<string, { reading: number; asking: number; rows: string[] }> = {};
  for (const file of readdirSync(`${dir}/answers`).toSorted()) {
    const [label, , width, task] = file.replace(/\.json$/, "").split("-") as [
      string,
      string,
      string,
      string,
    ];
    let x: Record<string, unknown>;
    try {
      x = JSON.parse(readFileSync(`${dir}/answers/${file}`, "utf8")) as Record<string, unknown>;
    } catch {
      x = {};
    }
    const s = score2(task, x, t, a);
    const r = (results[byLabel[label] ?? label] ??= { reading: 0, asking: 0, rows: [] });
    if (task.startsWith("a")) r.asking += s;
    else r.reading += s;
    r.rows.push(`${width} ${task} ${s} ${JSON.stringify(x).slice(0, 150)}`);
  }
  writeFileSync(`${dir}/graded.json`, JSON.stringify(results, null, 1));
  for (const [design, r] of Object.entries(results)) {
    console.log(
      `${design}: reading ${r.reading}, asking ${r.asking}, score ${r.reading + r.asking}`,
    );
    for (const row of r.rows) console.log("  ", row);
  }
}

const [cmd, round, ...rest] = process.argv.slice(2);
if (cmd === "prep" && round) prep(round, rest);
else if (cmd === "grade" && round) grade(round);
else if (cmd === "prep2" && round)
  prep2(
    round,
    rest.filter((x) => x !== "--asks"),
    rest.includes("--asks") ? "asks" : undefined,
  );
else if (cmd === "grade2" && round) grade2(round);
else
  console.log(
    "prep <round> <design...> | grade <round> | prep2 <round> <design...> [--asks] | grade2 <round>",
  );
