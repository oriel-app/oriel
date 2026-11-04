// Records one real Noticed pass on the screenshot script's window (SYN and
// its Slack fixture, with the Checkout, Boarding and Weather workstreams),
// through the server's own path, for `pnpm shots`'s noticed scenes to
// replay. Run it with the main checkout's .env; it prints the model's lines
// and writes them, by signal kind and subject, to scripts/noticed/pass.json.
// The key goes to the model client and nowhere else.
import { writeFileSync } from "node:fs";
import { anthropicProvider } from "../../packages/agent/src/index.ts";
import { anthropicFetch } from "../../packages/evals/src/anthropic.ts";
import { modelKey } from "../../packages/evals/src/cli.ts";
import { envFile } from "../../packages/evals/src/repo.ts";
import { createApp } from "../../packages/server/src/app.ts";
import type { NoticedView } from "../../packages/web/src/view.ts";

const env = process.argv[2];
const key = await modelKey(env, envFile);
if ("problem" in key) throw new Error(key.problem);
const model = "claude-sonnet-5-5";
const provider = anthropicProvider({
  apiKey: "set-by-the-transport",
  model,
  effort: "low",
  fetch: anthropicFetch(key.key),
});
const app = await createApp({
  db: ":memory:",
  jira: { kind: "fixture" },
  slack: { kind: "fixture" },
  noticer: async () => ({ provider, model }),
  reviewBase: new URL("http://localhost/review/"),
  sketchBase: new URL("http://localhost:1/"),
});
const call = async (method: string, path: string, body?: unknown) => {
  const url = new URL(path, "http://localhost");
  const reply = await app.api(
    {
      method,
      url: url.pathname,
      headers: { host: url.host, origin: "http://localhost", "content-type": "application/json" },
      body: async () => JSON.stringify(body ?? {}),
    },
    url,
  );
  if (!reply || reply.status >= 300) throw new Error(`${method} ${path}: ${reply?.status}`);
  return JSON.parse(String(reply.body)) as unknown;
};
for (const cluster of ["10001", "10002", "10003"])
  await call("POST", "/api/workstreams", { kind: "cluster", grouping: "epic", cluster });
await call("GET", "/api/noticed");
const t = performance.now();
// The pass runs in the background; wait for it as the strip polls.
let view: NoticedView;
for (;;) {
  view = (await call("GET", "/api/noticed")) as NoticedView;
  if (view.status !== "running") break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.log(`${view.status} after ${Math.round(performance.now() - t)}ms`);
const subjectOf = (card: NoticedView["cards"][number]) =>
  card.subject.kind === "workstream" ? `@${card.subject.name}` : card.subject.id;
for (const card of view.cards)
  console.log(
    `- ${card.kind} ${subjectOf(card)}: ${card.headline}\n  why: ${card.why}\n  quote: ${card.quote?.text ?? "—"}`,
  );
writeFileSync(
  new URL("pass.json", import.meta.url),
  `${JSON.stringify(
    view.cards.map((card) => ({
      kind: card.kind,
      subject: subjectOf(card),
      why: card.why,
      quote: card.quote,
    })),
    null,
    2,
  )}\n`,
);
await app.close();
