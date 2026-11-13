import { StringDecoder } from "node:string_decoder";
import { codes, type McpServer } from "./server.ts";

// A line longer than this is dropped unread, so a client can't make the
// server hold any amount it likes.
export const lineMost = 4 * 1024 * 1024;

type Out = { write(text: string): unknown };

export async function serveStdio(
  server: McpServer,
  input: AsyncIterable<string | Buffer> | Iterable<string | Buffer>,
  output: Out,
): Promise<void> {
  const pending = new Set<Promise<unknown>>();
  const send = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);

  const take = (line: string) => {
    if (line.trim() === "") return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: codes.parse, message: "Parse error" } });
      return;
    }
    const id = (message as { id?: unknown } | null)?.id;
    const done = server.handle(message).then(
      (answer) => {
        if (answer) send(answer);
      },
      () =>
        send({
          jsonrpc: "2.0",
          id: typeof id === "string" || typeof id === "number" ? id : null,
          error: { code: codes.internal, message: "Internal error" },
        }),
    );
    pending.add(done);
    void done.finally(() => pending.delete(done));
  };

  // A UTF-8 character may be split between chunks.
  const decoder = new StringDecoder("utf8");
  let held = "";
  let dropping = false;
  for await (const chunk of input) {
    held += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let end = held.indexOf("\n");
    while (end !== -1) {
      const line = held.slice(0, end).replace(/\r$/, "");
      held = held.slice(end + 1);
      if (dropping) dropping = false;
      else take(line);
      end = held.indexOf("\n");
    }
    if (held.length > lineMost) {
      if (!dropping)
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: codes.invalidRequest, message: "Message too long" },
        });
      held = "";
      dropping = true;
    }
  }
  held += decoder.end();
  if (!dropping) take(held);
  await Promise.all(pending);
}
