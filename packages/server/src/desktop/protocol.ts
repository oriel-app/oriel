// PROTOCOL.md beside this file tells the shell's side in prose.
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

export const launchCookie = "oriel-launch";

export const isLaunchSecret = (line: string): boolean => /^[0-9a-f]{64}$/.test(line);

// The server keeps none; the name stays only so the channel stays whole for whatever keeps a secret next.
export const isSecretName = (text: string): boolean => text === "anthropic-key";
const name = refine(string, isSecretName, "a secret the server keeps");
const secret = refine(string, (text) => Buffer.byteLength(text) <= 16_384, "at most 16 KiB");
const open = refine(
  string,
  (path) => path.length <= 200 && /^\/(?![/\\])[!-~]*$/.test(path),
  "a path on the server's origin",
);
const id = refine(number, (n) => Number.isSafeInteger(n) && n > 0, "a positive integer");
const count = refine(number, (n) => Number.isSafeInteger(n) && n >= 0, "a count");

export const request = union(
  object({ kind: literal("folder.pick"), prompt: string }),
  object({ kind: literal("secret.get"), name }),
  object({ kind: literal("secret.set"), name, secret }),
  object({ kind: literal("secret.delete"), name }),
  object({ kind: literal("notify"), title: string, body: string, open }),
  object({ kind: literal("window.focus") }),
  object({ kind: literal("working"), threads: count }),
);
export type ShellRequest = Infer<typeof request>;
export type RequestKind = ShellRequest["kind"];

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

export type ServerLine = { kind: "ready"; url: string } | ({ id: number } & ShellRequest);
