export type Comment = { line: number; text: string };

const wordsBeforeRegex = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
  "extends",
  "export",
  "default",
]);

export function comments(src: string, jsx: boolean): Comment[] {
  const found: Comment[] = [];
  const n = src.length;
  let i = 0;
  let prev: "word" | "value" | "punct" | "close" = "punct";
  const at = (k: number) => src.charAt(k);
  const idStart = (c: string) => /[A-Za-z_$\u0080-￿]/.test(c);
  const idPart = (c: string) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
  const operandNext = () => prev === "punct";
  let line = 1;
  const advanceTo = (k: number) => {
    for (; i < k; i++) if (src.charCodeAt(i) === 10) line++;
  };

  const comment = (): boolean => {
    const next = at(i + 1);
    if (next !== "/" && next !== "*") return false;
    const start = i;
    const startLine = line;
    const end = next === "/" ? src.indexOf("\n", i) : src.indexOf("*/", i + 2);
    advanceTo(end === -1 ? n : next === "/" ? end : end + 2);
    found.push({ line: startLine, text: src.slice(start, i) });
    return true;
  };
  const string = (quote: string) => {
    let k = i + 1;
    while (k < n && at(k) !== quote && at(k) !== "\n") k += at(k) === "\\" ? 2 : 1;
    advanceTo(k + 1);
    prev = "value";
  };
  const template = () => {
    advanceTo(i + 1);
    while (i < n) {
      const c = at(i);
      if (c === "\\") advanceTo(i + 2);
      else if (c === "`") {
        advanceTo(i + 1);
        break;
      } else if (c === "$" && at(i + 1) === "{") {
        advanceTo(i + 2);
        code(true);
        advanceTo(i + 1);
      } else advanceTo(i + 1);
    }
    prev = "value";
  };
  const regex = () => {
    let k = i + 1;
    let inClass = false;
    while (k < n && at(k) !== "\n") {
      const c = at(k);
      if (c === "\\") k++;
      else if (inClass) inClass = c !== "]";
      else if (c === "[") inClass = true;
      else if (c === "/") break;
      k++;
    }
    k++;
    while (k < n && idPart(at(k))) k++;
    advanceTo(k);
    prev = "value";
  };
  const children = () => {
    while (i < n) {
      const c = at(i);
      if (c === "{") {
        advanceTo(i + 1);
        code(true);
        advanceTo(i + 1);
      } else if (c === "<" && at(i + 1) === "/") {
        advanceTo(src.indexOf(">", i) + 1);
        return;
      } else if (c === "<") element();
      else advanceTo(i + 1);
    }
  };
  const element = () => {
    advanceTo(i + 1);
    if (at(i) === ">") {
      advanceTo(i + 1);
      children();
      return;
    }
    while (i < n) {
      const c = at(i);
      if (c === "/" && at(i + 1) === ">") {
        advanceTo(i + 2);
        prev = "value";
        return;
      }
      if (c === "/" && comment()) continue;
      if (c === ">") {
        advanceTo(i + 1);
        children();
        prev = "value";
        return;
      }
      if (c === '"' || c === "'") string(c);
      else if (c === "{") {
        advanceTo(i + 1);
        code(true);
        advanceTo(i + 1);
      } else advanceTo(i + 1);
    }
  };
  const code = (untilBrace: boolean) => {
    let depth = 0;
    while (i < n) {
      const c = at(i);
      if (/\s/.test(c)) advanceTo(i + 1);
      else if (c === "/" && comment()) continue;
      else if (c === '"' || c === "'") string(c);
      else if (c === "`") template();
      else if (c === "/") {
        if (operandNext()) regex();
        else {
          advanceTo(i + 1);
          prev = "punct";
        }
      } else if (jsx && c === "<" && operandNext() && (idStart(at(i + 1)) || at(i + 1) === ">"))
        element();
      else if (idStart(c)) {
        let k = i;
        while (k < n && idPart(at(k))) k++;
        prev = wordsBeforeRegex.has(src.slice(i, k)) ? "punct" : "word";
        advanceTo(k);
      } else if (/[0-9]/.test(c)) {
        let k = i;
        while (k < n && /[0-9A-Za-z_.]/.test(at(k))) k++;
        advanceTo(k);
        prev = "value";
      } else if (c === "{") {
        depth++;
        advanceTo(i + 1);
        prev = "punct";
      } else if (c === "}") {
        if (depth === 0 && untilBrace) return;
        depth--;
        advanceTo(i + 1);
        prev = "close";
      } else if (c === ")" || c === "]") {
        advanceTo(i + 1);
        prev = "close";
      } else {
        advanceTo(i + 1);
        prev = "punct";
      }
    }
  };

  code(false);
  return found;
}

const storyKey = /\bOA-\d+|#\d+\b/;

export function storyKeyComments(path: string, text: string): string[] {
  return comments(text, path.endsWith(".tsx"))
    .filter((c) => storyKey.test(c.text))
    .map(
      (c) =>
        `${path}:${c.line}: a comment names a story or PR (${storyKey.exec(c.text)?.[0]}); that goes in the commit and the PR`,
    );
}
