// A stand-in for the person's model in Noticed's pass, for `pnpm shots`: it
// answers with the lines a real pass wrote on the same window
// (record-pass.ts), matched to the signals this run offers by kind and
// subject, so the shots show what a model says without calling one.
import { readFileSync } from "node:fs";
import type { Provider } from "../../packages/agent/src/provider.ts";

type Recorded = {
  kind: string;
  subject: string;
  why: string | null;
  quote: { item: string; text: string } | null;
};

const recorded = JSON.parse(
  readFileSync(new URL("pass.json", import.meta.url), "utf8"),
) as Recorded[];

export function replayNoticer(): Provider {
  return {
    converse(request) {
      return {
        async *next() {
          const read = request.messages.flatMap((m) => (m.role === "tool" ? m.results : []));
          const offered = (read[0]?.content ?? "")
            .split("\n")
            .flatMap((line): { signal: string; kind: string; found: string }[] => {
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>;
                return typeof parsed.signal === "string" &&
                  typeof parsed.kind === "string" &&
                  typeof parsed.found === "string"
                  ? [{ signal: parsed.signal, kind: parsed.kind, found: parsed.found }]
                  : [];
              } catch {
                return [];
              }
            });
          for (const line of recorded) {
            const match = offered.find((signal) =>
              line.subject.startsWith("@")
                ? signal.kind === line.kind && signal.found.startsWith(`${line.subject.slice(1)}:`)
                : signal.signal === `${line.kind}:${line.subject}`,
            );
            if (!match) continue;
            yield {
              kind: "text",
              text: `${JSON.stringify({ signal: match.signal, why: line.why ?? "", quote: line.quote })}\n`,
            };
          }
          const usage = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
          yield { kind: "end", stop: "done", detail: null, model: "claude-sonnet-5-5", usage };
        },
      };
    },
  };
}
