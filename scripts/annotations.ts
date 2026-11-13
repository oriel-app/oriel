// CI's job logs need admin rights to read, so failures go out as `::error` lines,
// which become annotations on the run.
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export const onCi = process.env["GITHUB_ACTIONS"] === "true";

export function annotation(title: string, message: string, file?: string, line?: number): string {
  const escape = (text: string) =>
    text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const property = (text: string) => escape(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
  const at = [
    ...(file === undefined ? [] : [`file=${property(file)}`]),
    ...(line === undefined ? [] : [`line=${line}`]),
    `title=${property(title)}`,
  ].join(",");
  return `::error ${at}::${escape(message)}\n`;
}

type Failure = {
  name: string;
  file?: string;
  line?: number;
  details: { type?: string; error?: unknown };
};

function firstLine(error: unknown): string {
  // A failed assertion arrives wrapped, its own error as the cause.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split("\n").find((line) => line.trim() !== "") ?? text;
}

export default async function* annotations(
  source: AsyncIterable<{ type: string; data: unknown }>,
): AsyncGenerator<string> {
  for await (const event of source) {
    if (event.type !== "test:fail") continue;
    const failure = event.data as Failure;
    if (failure.details.type === "suite") continue;
    const file = failure.file === undefined ? undefined : relative(root, failure.file);
    yield annotation(
      `test failed: ${failure.name}`,
      firstLine(failure.details.error),
      file,
      failure.line,
    );
  }
}
