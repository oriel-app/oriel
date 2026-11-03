// Spike (reply-elements): screenshots of the same replies under each
// candidate, from the climb's rounds and the fixtures only. Its own server,
// on a free port; never the live one.
//
//   node spike/reply-elements/shots.ts --base <round> --r1 <round> --r2 <round>
//
// Arms: `today` (main: Markdown, links to threads drawn as OA-113's chips),
// `r0` (base's reply, item keys and thread links recognized and drawn as
// references), `r1` and `r2` (their rounds' replies). Each case's first
// trial, whatever it scored, so no reply is picked for how it looks.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { fileTitle, loadFolderFixture } from "../../scripts/fixtures/folder.ts";
import { loadSlackFixture } from "../../scripts/fixtures/slack.ts";
import { fileId } from "../../packages/evals/src/world.ts";
import { assets, dist, vendor } from "../../packages/web/files.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    r1: { type: "string" },
    r2: { type: "string" },
    only: { type: "string" },
  },
});
const root = new URL("../../", import.meta.url);
const out = new URL("out/", import.meta.url);
mkdirSync(out, { recursive: true });

type Transcript = { id: string; case: { prompt: string }; output: { reply: string } | null };
const replies = (round: string | undefined): Map<string, Transcript> => {
  const found = new Map<string, Transcript>();
  if (!round) return found;
  const dir = new URL(`.evals/${round}/transcripts/`, root);
  for (const name of readdirSync(dir).filter((n) => /^[a-z0-9-]+\.json$/.test(n))) {
    const t = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as Transcript;
    found.set(t.id, t);
  }
  return found;
};
const base = replies(values.base);
const r1 = replies(values.r1);
const r2 = replies(values.r2);

// Item keys and thread links in a reply that teaches neither, as a source's
// recognizer would find them; never inside a quote, where text is the item's.
function recognized(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*>/.test(line)) return line;
      const parts = line.split(/("[^"]*"|“[^”]*”|`[^`]*`)/);
      return parts
        .map((part, i) =>
          i % 2
            ? part
            : part
                .replace(
                  /\[[^\]]*\]\(\/threads\/([0-9A-Z]{26})(?:\?changeSet=([0-9A-Z]{26}))?\)/g,
                  (_, t: string, c?: string) => `[[${c ?? t}]]`,
                )
                .replace(/(?<![\w:[-])(SYN-\d+)\b/g, "[[jira:$1]]"),
        )
        .join("");
    })
    .join("\n");
}

const scenes = [...base.values()]
  .filter((t) => t.output && (!values.only || t.id.startsWith(values.only)))
  .map((t) => ({
    id: t.id,
    user: t.case.prompt,
    replies: {
      today: t.output?.reply,
      r0: recognized(t.output?.reply ?? ""),
      r1: r1.get(t.id)?.output?.reply,
      r2: r2.get(t.id)?.output?.reply,
    },
  }));

// What each reference names, from the fixtures and the cases' workspace.
type Issue = {
  key: string;
  summary: string;
  description: string;
  status: { name: string; category: string };
  comments: { body: string }[];
};
const issues = JSON.parse(
  readFileSync(new URL("fixtures/jira/issues.json", root), "utf8"),
) as Issue[];
const refs: Record<string, unknown> = {};
for (const issue of issues)
  refs[`jira:${issue.key}`] = {
    kind: "item",
    source: "jira",
    key: issue.key,
    name: issue.summary,
    state: { id: issue.status.category, name: issue.status.name },
    text: [issue.summary, issue.description, ...issue.comments.map((c) => c.body)].join("\n"),
  };
for (const file of loadFolderFixture().files)
  refs[fileId(file.path)] = {
    kind: "item",
    source: "folder",
    key: null,
    name: fileTitle(file.path),
    state: null,
    text: file.text,
  };
const slack = loadSlackFixture();
for (const channel of slack.channels)
  for (const message of channel.messages) {
    const who = slack.users.find((u) => u.id === message.user)?.real_name ?? "Someone";
    refs[`slack:${channel.id}-${message.ts}`] = {
      kind: "item",
      source: "slack",
      key: null,
      name: `${who} in #${channel.name}`,
      state: null,
      text: message.text,
    };
  }
type Workspace = {
  threads: { id: string; name: string; state: string; workstream: { id: string; name: string } }[];
  changeSets: { id: string; thread: string; state: string; changes: { sentence: string }[] }[];
};
const oriel = (
  JSON.parse(
    readFileSync(new URL("packages/evals/cases/find-approved-slack-post.json", root), "utf8"),
  ) as { oriel: Workspace }
).oriel;
const stateName: Record<string, string> = {
  working: "Working",
  done: "Done",
  applied: "Applied",
  rejected: "Rejected",
  pending: "Waiting",
};
for (const t of oriel.threads) {
  refs[t.id] = {
    kind: "thread",
    source: null,
    key: null,
    name: t.name,
    state: { id: t.state, name: stateName[t.state] },
  };
  refs[t.workstream.id] = {
    kind: "workstream",
    source: null,
    key: null,
    name: t.workstream.name,
    state: null,
  };
}
for (const c of oriel.changeSets)
  refs[c.id] = {
    kind: "change-set",
    source: null,
    key: null,
    name: c.changes[0]?.sentence.replace(/\.$/, "") ?? "Change set",
    state: { id: c.state, name: stateName[c.state] },
  };
const workspace = {
  threads: oriel.threads.map((t) => ({
    id: t.id,
    title: t.name,
    workstream: t.workstream,
    state: t.state,
    doneBy: null,
    waitingOn: null,
    activityAt: "2026-10-29T09:00:00.000Z",
  })),
  changeSets: oriel.changeSets,
};
const data = JSON.stringify({ scenes, refs, workspace });

const importMap = JSON.stringify({
  imports: Object.fromEntries([...vendor.keys()].map((s) => [s, `/vendor/${s}.js`])),
});
const page = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/assets/window.css">
<style>.spike-frame{max-width:720px;margin:0 auto;padding:20px 20px 4px}</style>
<script type="importmap">${importMap}</script>
<script type="module" src="/app/spike-replies.js"></script><div id="app"></div>`;
const types: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://x").pathname;
  const send = (type: string, body: string | Buffer) => {
    response.writeHead(200, { "content-type": type });
    response.end(body);
  };
  try {
    if (path === "/") return send("text/html", page);
    if (path === "/spike/data.json") return send("application/json", data);
    const vendored = [...vendor].find(([s]) => path === `/vendor/${s}.js`);
    if (vendored) return send(types[".js"] ?? "", readFileSync(vendored[1]));
    const [dir, rest] = path.startsWith("/app/")
      ? [dist, path.slice(5)]
      : path.startsWith("/assets/")
        ? [assets, path.slice(8)]
        : [null, ""];
    if (dir && !rest.includes(".."))
      return send(types[extname(rest)] ?? "text/plain", readFileSync(new URL(rest, dir)));
  } catch {}
  response.writeHead(404);
  response.end();
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

const browser = await chromium.launch({ channel: "chrome" });
const problems: string[] = [];
for (const theme of ["light", "dark"] as const)
  for (const width of [760, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
    page.on("pageerror", (error) => problems.push(error.message));
    for (const scene of scenes)
      for (const arm of ["today", "r0", "r1", "r2"] as const) {
        if (!scene.replies[arm]) continue;
        await page.goto(`http://127.0.0.1:${port}/?scene=${scene.id}&arm=${arm}`);
        await page.locator("body[data-ready]").waitFor();
        await page.locator(".spike-frame").screenshot({
          path: fileURLToPath(new URL(`${scene.id}-${arm}-${theme}-${width}.png`, out)),
        });
      }
    await page.close();
  }
await browser.close();
server.close();
writeFileSync(new URL("scenes.json", out), JSON.stringify(scenes, null, 2));
console.log(
  `${scenes.length} scenes${problems.length ? `; problems: ${problems.join("; ")}` : ""}`,
);
