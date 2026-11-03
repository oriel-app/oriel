// Builds a direction's specimen page: every primitive and component, drawn
// with the window's own stylesheet and, where the window has one, its own
// markup (fragments/, saved from `pnpm shots` scenes on the fixtures).
// `node spike/visual/d1/build.mjs a` writes spike/visual/d1/a/specimen.html.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
const here = new URL("./", import.meta.url);
const frag = (name) => readFileSync(new URL(`fragments/${name}.html`, here), "utf8");

const directions = {
  a: {
    name: "A · Ledger",
    idea: [
      "Today's window, made calmer and more exact: warm greys, one indigo accent that means “your move”, and state told by colour you already know (grey to do, blue in progress, green landed).",
      "Hairlines and a single soft lift instead of boxes inside boxes, one sans throughout, and a compact row for every list so forty workstreams still fit on a laptop.",
    ],
  },
  b: {
    name: "B · Ink and signal",
    idea: [
      "Colour is a budget spent only on what needs you: the window is ink on paper, states are shapes, and a single vermilion marks the things waiting on the user, so the eye goes there first.",
      "Words someone wrote (the agent's reply, a ticket's description, a message) are set in a serif; everything Oriel draws from its own data (chips, states, blocks, controls) is sans and mono, so you can tell a claim from a fact by its type.",
    ],
  },
};
const d = directions[dir];
if (!d) throw new Error("Say a or b");

// Inline SVG for the kinds: 16 by 16, a 1.5 stroke, round ends, no fill.
const icon = {
  item: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2"/><path d="M5.5 6h5M5.5 9h3"/>',
  thread: '<path d="M4 2.75v10.5"/><path d="M7 4.5h5.5M7 8h4M7 11.5h5.5"/>',
  "change-set":
    '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2"/><path d="M8 4.75v3.5M6.25 6.5h3.5M6.25 10.75h3.5"/>',
  workstream:
    '<path d="M8 2.5l5.5 3-5.5 3-5.5-3z"/><path d="M2.5 8.5l5.5 3 5.5-3"/><path d="M2.5 11.25l5.5 3 5.5-3" opacity=".55"/>',
  file: '<path d="M4 2.75h5l3 3v7.5H4z"/><path d="M9 2.75v3h3"/>',
  message: '<path d="M2.75 3.25h10.5v7.5H7.5L4.5 13.25v-2.5H2.75z"/>',
};
const svg = (kind, cls = "chip-icon") =>
  `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${icon[kind]}</svg>`;

const chip = (kind, key, name, state, stateName) =>
  `<a class="chip-link" href="#"><span class="chip" data-kind="${kind}"${state ? ` data-state="${state}"` : ""}>${svg(kind)}${key ? `<span class="chip-key">${key}</span>` : ""}<span class="chip-name">${name}</span>${stateName ? `<span class="chip-state">${stateName}</span>` : ""}</span></a>`;

// The one accent: A's indigo, or B's signal (B's buttons and links are ink).
const accent = dir === "b" ? "--signal" : "--accent";
const onAccent = dir === "b" ? "--on-signal" : "--on-accent";
const neutrals = ["--n0", "--n1", "--n2", "--n3", "--n4", "--n5", "--n6", "--n7"];
const states = [
  ["--todo", "To do"],
  ["--in-progress", "In progress"],
  ["--done", "Done"],
  ["--needs-you", "Needs you"],
  ["--stalled", "Stalled or error"],
  ["--applied", "Applied"],
  ["--reverted", "Reverted"],
];

// The agent's HTML for the frame: a timeline it drew, with a fake Approve
// in it, as synced text might steer it to draw.
const agentHtml = `<!doctype html><style>
body{margin:0;padding:14px 16px;font:14px/1.4 Helvetica,Arial,sans-serif;color:#222;background:#fff}
h3{margin:0 0 10px;font-size:15px}
.t{display:flex;gap:6px;margin-bottom:12px}.t div{flex:1;padding:8px;border-radius:6px;background:#eef3ff;font-size:12px}
.t div:nth-child(2){background:#e9f7ee}.t div:nth-child(3){background:#fff4e0}
button{padding:6px 14px;border:0;border-radius:6px;background:#3d47c4;color:#fff;font:600 13px Helvetica,Arial}
</style><h3>Gift cards: the next three weeks</h3><div class="t"><div><b>Week 1</b><br>Pay with a gift card</div><div><b>Week 2</b><br>Balance at checkout</div><div><b>Week 3</b><br>Top up with a card</div></div><button>Approve and apply</button>`;

const contrastPairs = [
  ...["--n7", "--n6", "--n5"].flatMap((t) => ["--n0", "--n1", "--n2"].map((b) => [t, b])),
  [accent, "--n0"],
  [accent, "--n1"],
  [onAccent, accent],
  ...(dir === "b" ? [["--n0", "--n7"]] : []),
  ...states.flatMap(([t]) => [
    [t, "--n0"],
    [t, "--n1"],
    [t, `tint(${t})`],
  ]),
  ["--n7", "tint(--applied)"],
  ["--n7", "tint(--stalled)"],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Oriel visual identity, ${d.name}</title>
<link rel="stylesheet" href="../../../../packages/web/assets/window.css">
<style>
  body { container: none; }
  .spec { max-width: 72rem; margin: 0 auto; padding: var(--space-8) var(--space-6); }
  .spec h1 { margin: 0 0 var(--space-2); font-size: var(--text-xl); font-weight: var(--weight-strong); }
  .spec > header p { max-width: 46rem; margin: 0 0 var(--space-2); color: var(--text-muted); }
  .spec h2 { margin: var(--space-8) 0 var(--space-3); padding-top: var(--space-3); border-top: var(--border-thin) solid var(--line); font-size: var(--text-xs); font-weight: var(--weight-strong); letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
  .spec h3 { margin: var(--space-4) 0 var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: var(--space-3); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); align-items: start; }
  .sw { font-size: var(--text-xs); color: var(--text-muted); }
  .sw i { display: block; height: 2.5rem; margin-bottom: var(--space-1); border: var(--border-thin) solid var(--line); border-radius: var(--radius-sm); }
  .sw b { display: block; color: var(--text); font-family: var(--font-mono); font-weight: var(--weight-regular); }
  .cr { columns: 3; column-gap: var(--space-6); font: var(--text-xs) var(--font-mono); }
  .cr p { display: flex; gap: var(--space-2); margin: 0; padding: 2px 0; border-bottom: var(--border-thin) solid var(--line); break-inside: avoid; }
  .cr p span:first-child { flex: 1; }
  .cr .fail { color: var(--stalled); font-weight: var(--weight-strong); }
  .type-row { display: flex; align-items: baseline; gap: var(--space-4); padding: var(--space-1) 0; border-bottom: var(--border-thin) solid var(--line); }
  .type-row code { width: 12rem; flex: none; color: var(--text-faint); font: var(--text-xs) var(--font-mono); }
  .space-row { display: flex; align-items: center; gap: var(--space-3); font: var(--text-xs) var(--font-mono); color: var(--text-muted); }
  .space-row span { display: inline-block; height: 0.75rem; background: var(--accent); }
  .shape { display: inline-grid; place-items: center; width: 6rem; height: 4rem; margin-right: var(--space-3); border: var(--border-thin) solid var(--line-strong); background: var(--surface); font-size: var(--text-xs); color: var(--text-muted); }
  .icons { display: flex; gap: var(--space-6); flex-wrap: wrap; }
  .icons figure { margin: 0; text-align: center; font-size: var(--text-xs); color: var(--text-muted); }
  .icons svg { display: block; margin: 0 auto var(--space-1); width: 16px; height: 16px; fill: none; stroke: var(--text); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .icons.big svg { width: 32px; height: 32px; stroke-width: 0.75; }
  .stage { position: relative; padding: var(--space-4); border: var(--border-thin) dashed var(--line); border-radius: var(--radius-sm); background: var(--bg); }
  .stage .undos, .stage .item-panel, .stage .window-chat { position: static; transform: none; width: auto; opacity: 1; visibility: visible; }
  .stage .item-panel { max-height: 34rem; overflow: hidden; border: var(--border-thin) solid var(--line); }
  .stage .make-workstream { opacity: 1; }
  .states { display: grid; grid-template-columns: repeat(4, max-content); gap: var(--space-3) var(--space-6); align-items: center; }
  .buttons { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
  .note { color: var(--text-muted); font-size: var(--text-sm); max-width: 46rem; }
  ol.chat { list-style: none; margin: 0; padding: 0; }
</style>
</head>
<body>
<main class="spec">
<header>
  <h1>Oriel · ${d.name}</h1>
  ${d.idea.map((p) => `<p>${p}</p>`).join("")}
</header>

<h2>1 · Colour</h2>
<h3>Neutrals, surface to ink</h3>
<div class="grid">${neutrals.map((n) => `<div class="sw"><i style="background:var(${n})"></i><b>${n}</b><span data-value="${n}"></span></div>`).join("")}</div>
<h3>One accent, seven states, and each state's tint</h3>
<div class="grid">
  <div class="sw"><i style="background:var(${accent})"></i><b>${accent}</b><span data-value="${accent}"></span></div>
  ${states.map(([t, name]) => `<div class="sw"><i style="background:linear-gradient(90deg,var(${t}) 55%, color-mix(in srgb, var(${t}) var(--tint), var(--n0)) 55%)"></i><b>${t}</b>${name} <span data-value="${t}"></span></div>`).join("")}
</div>
<h3>Text on background, WCAG 2 contrast (AA is 4.5 for text)</h3>
<div id="cr" class="cr"></div>

<h2>2 · Type</h2>
<div class="two"><div>
${[
  ["--text-xl", "Workstream and thread titles"],
  ["--text-lg", "Section heads, the ask bar"],
  ["--text-md", "Body, rows, the reply"],
  ["--text-sm", "Secondary lines, buttons"],
  ["--text-xs", "Labels, counts, state"],
]
  .map(
    ([t, use]) =>
      `<div class="type-row"><code>${t}</code><span style="font-size:var(${t})">${use}</span></div>`,
  )
  .join("")}
${dir === "b" ? '<div class="type-row"><code>--text-prose</code><span style="font:var(--text-prose)/var(--leading-prose) var(--font-prose)">The agent\'s reply, a description, a message</span></div>' : ""}
<div class="type-row"><code>--font-mono</code><span style="font:var(--text-sm) var(--font-mono)">jira:SYN-45 · 01M6FYSS</span></div>
</div><div>
<div class="type-row"><code>--weight-regular</code><span style="font-weight:var(--weight-regular)">Regular, for reading</span></div>
<div class="type-row"><code>--weight-medium</code><span style="font-weight:var(--weight-medium)">Medium, for names</span></div>
<div class="type-row"><code>--weight-strong</code><span style="font-weight:var(--weight-strong)">Strong, for titles</span></div>
<div class="type-row"><code>--leading-tight</code><span>Rows and labels, one line each</span></div>
<div class="type-row"><code>--leading</code><span>The window's default</span></div>
<div class="type-row"><code>--leading-prose</code><span>Replies and descriptions</span></div>
</div></div>
<p class="note">Stacks: <code id="font"></code>${dir === "b" ? ' · prose: <code id="font-prose"></code>' : ""} · mono: <code id="font-mono"></code></p>

<h2>3 · Space and shape</h2>
<div class="two"><div>
${["--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8"]
  .map((s) => `<div class="space-row"><span style="width:var(${s})"></span>${s}</div>`)
  .join("")}
</div><div>
<span class="shape" style="border-radius:var(--radius-sm)">--radius-sm</span><span class="shape" style="border-radius:var(--radius)">--radius</span><span class="shape" style="border-radius:var(--radius-lg)">--radius-lg</span>
<p></p>
<span class="shape" style="border-width:var(--border-thin)">--border-thin</span><span class="shape" style="border:var(--border-thick) solid var(--text)">--border-thick</span>
<p></p>
<span class="shape" style="border-color:var(--line);box-shadow:var(--elevation-1)">--elevation-1</span><span class="shape" style="border-color:var(--line);box-shadow:var(--elevation-2)">--elevation-2</span>
</div></div>

<h2>4 · Motion</h2>
<p class="note"><code>--duration-quick</code> <span data-value="--duration-quick"></span> for a state changing in place (hover, a row's actions, a chevron); <code>--duration-move</code> <span data-value="--duration-move"></span> for something arriving (the panel, the sidebar, the window chat), both on <code>--ease</code> <span data-value="--ease"></span>. Under prefers-reduced-motion, <code>--duration-move</code> is 0: the panel fades without sliding, the sidebar and rows jump, and the working dot stops pulsing.</p>

<h2>5 · Icons</h2>
<p class="note">16 px on a 16 grid, a 1.5 stroke, round ends and joins, no fill; drawn in the text colour beside them. At 32 px the stroke stays 1.5 px on screen.</p>
<div class="icons">${Object.keys(icon)
  .map(
    (k) =>
      `<figure>${svg(k, "")}${k === "message" ? "Slack message" : k.replace("-", " ")}</figure>`,
  )
  .join("")}</div>
<div class="icons big" style="margin-top:var(--space-3)">${Object.keys(icon)
  .map((k) => `<figure>${svg(k, "")}</figure>`)
  .join("")}</div>

<h2>6 · Density</h2>
<p class="note">${
  dir === "a"
    ? "One rule: a surface that lists records is compact (a 2 rem row, <code>--text-md</code>, <code>--leading-tight</code>); a surface that shows one record's words is comfortable (<code>--leading-prose</code>, a 44 rem measure). The overview, Browse, the rails and blocks are compact; a thread's reply, the panel and the review link are comfortable."
    : "One rule: Oriel's own data is compact, words are comfortable. Every list of records (the overview, Browse, rails, blocks) keeps a 2 rem row in sans; prose (a reply, a description, a message) gets the serif at <code>--text-lg</code> and <code>--leading-prose</code>, a 40 rem measure, whatever surface it is on."
}</p>

<h2>7 · Components</h2>
<h3>Chip (0032), inline in a sentence, no box</h3>
<div class="stage"><ol class="chat"><li class="reply"><p>${chip("item", "SYN-45", "Rebook onto the next sailing in two taps", "in-progress", "In progress")} went to the team in ${chip("thread", "", "SYN-61 is ready to pick up", "done", "Done")}, when you approved ${chip("change-set", "", "Hand SYN-61 to the team", "applied", "Applied")}. Chen's notes are in ${chip("file", "", "meeting-notes.md", null, null)}, and the question came up in ${chip("message", "", "Chen Yuting: is the SMS copy final?", null, null)}. It all sits in ${chip("workstream", "", "SMS updates", null, "3 items")}, and ${chip("item", "SYN-93", "Investigate slow search on the timetable page", "todo", "To do")} is still waiting. A revert: ${chip("change-set", "", "Mark the built stories done", "reverted", "Reverted")}; one stuck: ${chip("change-set", "", "Move SYN-61 to Ready for Dev", "stalled", "Stalled")}; one for you: ${chip("thread", "", "Where did I approve the post?", "needs-you", "Needs you")}.</p></li></ol></div>
<h3>The same chips today on main (a thread and a change set), from the thread-chips scene</h3>
<div class="stage"><ol class="chat">${frag("chips")}</ol></div>

<h3>State mark</h3>
<div class="stage states">
  <span class="state-chip" data-state="working">Working</span>
  <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
  <span class="state-chip" data-state="done">Done</span>
  <span class="state-chip" data-state="handed-off">Handed off</span>
  <span class="status" data-category="todo">To Do</span>
  <span class="status" data-category="in-progress">In Progress</span>
  <span class="status" data-category="done">Done</span>
  <span><span class="status-bar" style="width:6rem;display:inline-flex"><span class="segment done" style="flex-grow:5"></span><span class="segment in-progress" style="flex-grow:4"></span><span class="segment todo" style="flex-grow:4"></span></span></span>
  <span style="display:flex;gap:6px;align-items:center"><span class="state-dot" data-state="working"></span>working</span>
  <span style="display:flex;gap:6px;align-items:center"><span class="state-dot" data-state="working" data-waiting="review"></span>needs you</span>
  <span style="display:flex;gap:6px;align-items:center"><span class="state-dot" data-state="done"></span>done</span>
  <span style="display:flex;gap:6px;align-items:center"><span class="state-dot" data-state="dropped"></span>dropped</span>
  ${states.map(([t, name]) => `<span class="chip" data-state="${{ "--todo": "todo", "--in-progress": "in-progress", "--done": "done", "--needs-you": "needs-you", "--stalled": "stalled", "--applied": "applied", "--reverted": "reverted" }[t]}"><span class="chip-state">${name}</span></span>`).join("")}
</div>

<h3>Button: primary, secondary, quiet, danger</h3>
<div class="stage buttons"><button class="button primary">Approve and apply</button><button class="button">Reject</button><button class="quiet-action">Share review link</button><button class="button danger">Delete</button><button class="button primary" disabled>Ask</button></div>

<h3>Ask bar and input</h3>
<div class="stage">${frag("askbar")}<form class="composer" style="margin-top:var(--space-4)"><textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea><button type="submit" class="button primary">Send</button></form></div>

<h3>Workstream card (overview)</h3>
<div class="stage">${frag("workstreams")}</div>

<h3>List row (Browse, an epic open)</h3>
<div class="stage window">${frag("cluster")}</div>

<h3>Block (0030): rows and bars from the window chat, and a table</h3>
<div class="stage"><ol class="chat">${frag("blocks")}<li class="block-entry"><figure class="answer-block" data-form="table"><table class="block-table"><thead><tr><th scope="col">name</th><th scope="col" class="num">size</th><th scope="col" class="num">moved</th><th scope="col" class="num">idleDays</th></tr></thead><tbody><tr><td>Checkout v2: phone wallets and saved cards</td><td class="num">17</td><td class="num">3</td><td class="num">0</td></tr><tr><td>Boarding passes and gate scanning</td><td class="num">9</td><td class="num">1</td><td class="num">14</td></tr><tr><td>Saved cards launch</td><td class="num">6</td><td class="num">0</td><td class="num">21</td></tr></tbody></table><figcaption>Computed by Oriel from the overview: Workstreams</figcaption></figure></li></ol></div>

<h3>Note: Undo, and Oriel's own lines in a thread</h3>
<div class="stage two"><div>${frag("undos")}</div><ol class="chat">${frag("actions")}<li class="oriel-note" role="note"><p>You rejected this change set: “Keep the epic's name.” The agent sees your reason on its next turn.</p></li></ol></div>

<h3>Panel (an item in its source's own view)</h3>
<div class="stage">${frag("panel")}</div>

<h3>Diff line (a change set's adds and removes)</h3>
<div class="stage"><ol class="chat">${frag("changeset")}</ol></div>

<h3>The agent's HTML frame (0033): a fake Approve inside it</h3>
<div class="stage"><ol class="chat"><li class="reply"><p>Here is the plan as a timeline.</p></li></ol>
<figure class="agent-frame"><figcaption class="agent-frame-label">${svg("item", "chip-icon")}<strong>Drawn by the agent</strong><span>Not checked against Oriel's data. Nothing in it acts; approve below.</span></figcaption><div class="agent-frame-fence"><iframe sandbox="" height="150" title="Drawn by the agent" srcdoc="${agentHtml.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></div></figure>
<div class="buttons"><button class="button primary">Approve and apply</button><button class="button">Reject</button></div>
</div>
</main>
<script>
  const pairs = ${JSON.stringify(contrastPairs)};
  const probe = document.createElement("i");
  document.body.append(probe);
  const resolve = (token) => {
    const m = token.match(/^tint\\((.+)\\)$/);
    probe.style.color = m ? "color-mix(in srgb, var(" + m[1] + ") var(--tint), var(--n0))" : "var(" + token + ")";
    const c = getComputedStyle(probe).color;
    const n = c.match(/[\\d.]+/g).map(Number);
    return c.startsWith("color(") ? n.slice(0, 3) : n.slice(0, 3).map((v) => v / 255);
  };
  const lum = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = (c) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const rows = pairs.map(([t, b]) => { const r = ratio(resolve(t), resolve(b)); return { t, b, r }; });
  document.querySelector("#cr").innerHTML = rows.map(({ t, b, r }) =>
    "<p><span><span style=\\"display:inline-block;width:10px;height:10px;margin-right:4px;background:" + (b.startsWith("tint") ? "color-mix(in srgb, var(" + b.slice(5, -1) + ") var(--tint), var(--n0))" : "var(" + b + ")") + ";border:1px solid var(--line)\\"></span>" + t + " on " + b + "</span><span>" + r.toFixed(2) + "</span><span class=" + (r >= 4.5 ? "" : "fail") + ">" + (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : "fails") + "</span></p>").join("");
  for (const el of document.querySelectorAll("[data-value]")) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(el.dataset.value).trim();
    el.textContent = v.startsWith("#") || v.startsWith("var(") || v.startsWith("color") ? hex(resolve(el.dataset.value)) : v;
  }
  for (const id of ["font", "font-prose", "font-mono"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = getComputedStyle(document.documentElement).getPropertyValue("--" + id).trim();
  }
  window.contrast = rows.map(({ t, b, r }) => [t, b, +r.toFixed(2)]);
  probe.remove();
</script>
</body>
</html>
`;
mkdirSync(new URL(`${dir}/`, here), { recursive: true });
writeFileSync(new URL(`${dir}/specimen.html`, here), html);
console.log(`wrote spike/visual/d1/${dir}/specimen.html`);
