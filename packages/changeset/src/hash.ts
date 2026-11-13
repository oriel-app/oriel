import { createHash } from "node:crypto";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Status and results are left out, so applying doesn't change it.
export function changeSetHash(
  rows: readonly {
    seq: number;
    op: string;
    target: string | null;
    ref: string | null;
    into?: string;
    args: unknown;
  }[],
): string {
  const content = [...rows]
    .sort((a, b) => a.seq - b.seq)
    .map((m) =>
      m.into === undefined
        ? [m.seq, m.op, m.target, m.ref, m.args]
        : [m.seq, m.op, m.target, m.ref, m.args, m.into],
    );
  return sha256(`oriel.changeset.v1\n${canonical(content)}`);
}
