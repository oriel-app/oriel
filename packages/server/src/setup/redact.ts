// What a line from the person's CLI or its installer may say in the log they
// can copy to whoever helps them (decision 0038): never a password, a key, a
// code, an email, or a link's query, where a sign-in link carries its state
// and code. Oriel's own lines are written by Oriel and need none of this.
import { homeRelativeIn } from "@oriel/core";

const maxLine = 300;

export function redacted(line: string, home: string): string {
  let text = line
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    // A value given to a word that names a secret, as `code: …`, `token=…`
    // or JSON's `"password":"…"`, whole, before any other rule cuts it.
    .replace(
      /\b(password|passwd|secret|token|api[_ -]?key|code)(["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,;}]+)/gi,
      "$1$2[hidden]",
    )
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [hidden]")
    // A link keeps its site and path; its query and fragment go.
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?…")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[key]")
    // Long runs of letters and digits, as keys, codes and tokens are.
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[hidden]");
  text = homeRelativeIn(text, home);
  return text.length > maxLine ? `${text.slice(0, maxLine)}…` : text;
}
