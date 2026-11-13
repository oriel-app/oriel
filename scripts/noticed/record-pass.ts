// `node scripts/noticed/record-pass.ts <the main checkout's .env>`; writes pass.json.
// The key goes to the model client and nowhere else.
import { writeFileSync } from "node:fs";
import { anthropicProvider } from "../../packages/agent/src/index.ts";
import { anthropicFetch, cost } from "../../packages/evals/src/anthropic.ts";
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
  sources: { jira: { mode: "fixture" }, slack: { mode: "fixture" } },
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
await app.settled();
const view = (await call("GET", "/api/noticed")) as NoticedView;
for (const pass of app.telemetry().filter((event) => event.name === "noticed.pass")) {
  const { inputTokens, outputTokens, firstMs, ms, ok } = pass.data as Record<string, number>;
  const dollars = cost(model, {
    input: inputTokens ?? 0,
    output: outputTokens ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  console.log(
    `pass: ${ok ? "ok" : "failed"}, first card ${firstMs}ms, ${ms}ms in all, ${inputTokens} in / ${outputTokens} out, $${dollars?.toFixed(4)}`,
  );
}
console.log(view.status);
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
