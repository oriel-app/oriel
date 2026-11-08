// The messages between the desktop app's shell and its server (decision
// 0036), as validated types. PROTOCOL.md beside this file tells the shell's
// side in prose: the launch secret on stdin's first line, its cookie, then
// one JSON object per line each way. The server asks; the shell answers each
// request once, by its id, in any order.
import { isAbsolute } from "node:path";
import {
  type Infer,
  literal,
  nullable,
  number,
  object,
  refine,
  string,
  union,
  unknown,
  type Validator,
} from "@oriel/core";

// The cookie the shell puts in the webview's store, holding the secret.
export const launchCookie = "oriel-launch";

// 32 bytes, as 64 lowercase hex characters.
export const isLaunchSecret = (line: string): boolean => /^[0-9a-f]{64}$/.test(line);

// The secrets the server keeps, by name: the API key the agent can run on
// (OA-188). No connection keeps one since decision 0059: a source is read
// through the person's own agent, which holds its sign-in. The shell takes
// no other name.
export const isSecretName = (text: string): boolean => text === "anthropic-key";
const name = refine(string, isSecretName, "a secret the server keeps");
const secret = refine(string, (text) => Buffer.byteLength(text) <= 16_384, "at most 16 KiB");
// Where a click on a notification takes the window: a path on the server's
// own origin, such as `/threads/<id>`.
const open = refine(
  string,
  (path) => path.length <= 200 && /^\/(?![/\\])[!-~]*$/.test(path),
  "a path on the server's origin",
);
const id = refine(number, (n) => Number.isSafeInteger(n) && n > 0, "a positive integer");
const count = refine(number, (n) => Number.isSafeInteger(n) && n >= 0, "a count");

// What the server asks the shell for, without its id.
export const request = union(
  object({ kind: literal("folder.pick"), prompt: string }),
  object({ kind: literal("secret.get"), name }),
  object({ kind: literal("secret.set"), name, secret }),
  object({ kind: literal("secret.delete"), name }),
  object({ kind: literal("notify"), title: string, body: string, open }),
  // The first run brings Oriel back to the front once the CLI's sign-in in
  // the browser ends (decision 0038).
  object({ kind: literal("window.focus") }),
  // How many threads Oriel is working on, for asking before quitting
  // (decision 0045); 0 while Settings has that off.
  object({ kind: literal("working"), threads: count }),
);
export type ShellRequest = Infer<typeof request>;
export type RequestKind = ShellRequest["kind"];

// What a successful answer's `value` is, for each kind of request.
export const answers = {
  "folder.pick": nullable(refine(string, isAbsolute, "an absolute path")),
  "secret.get": nullable(string),
  "secret.set": literal(null),
  "secret.delete": literal(null),
  notify: literal(null),
  "window.focus": literal(null),
  working: literal(null),
} satisfies Record<RequestKind, Validator<unknown>>;
export type Answer<K extends RequestKind> = Infer<(typeof answers)[K]>;

// A line from the shell. Its value is checked against the request's kind
// once the id finds the request.
export const reply = union(
  object({ id, ok: literal(true), value: unknown }),
  object({ id, ok: literal(false), error: string }),
);
export type ShellReply = Infer<typeof reply>;

// Lines to the shell.
export type ServerLine = { kind: "ready"; url: string } | ({ id: number } & ShellRequest);
