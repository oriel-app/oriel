// Google's `fields` parameter: which parts of an answer to send. Fields are
// comma-separated, a nested field is reached with `/` (Drive) or `.`
// (Sheets), parentheses select several fields below one, and `*` is every
// field at its level. A field the answer's type doesn't have is a `400`,
// "Invalid field selection".
// https://developers.google.com/workspace/drive/api/guides/fields-parameter
// https://developers.google.com/workspace/sheets/api/guides/field-masks

// What a field selects below it: null for all of it.
export type Mask = Map<string, Mask | null>;

// The fields a type has, as a tree: `true` where nothing below can be
// selected. An array's elements share their type, so a schema names no
// index.
export type Schema = { readonly [field: string]: Schema | true };

export function parseMask(text: string): Mask | { invalid: string } {
  const mask: Mask = new Map();
  let at = 0;
  const fail = () => ({ invalid: text.slice(at) || text });

  // A list of selections up to `close` or the end, into `into`.
  const list = (into: Mask, close: string | null): boolean => {
    for (;;) {
      const path: string[] = [];
      for (;;) {
        const name = /^\s*([A-Za-z_][A-Za-z0-9_]*|\*)\s*/.exec(text.slice(at));
        if (!name?.[1]) return false;
        path.push(name[1]);
        at += name[0].length;
        if (text[at] !== "/" && text[at] !== ".") break;
        at++;
      }
      let below: Mask | null = null;
      if (text[at] === "(") {
        at++;
        below = new Map();
        if (!list(below, ")")) return false;
      }
      add(into, path, below);
      if (text[at] === ",") {
        at++;
        continue;
      }
      if (close === null) return at === text.length;
      if (text[at] !== close) return false;
      at++;
      return true;
    }
  };
  return list(mask, null) ? mask : fail();
}

// Two selections of one field select what either does.
function add(into: Mask, path: string[], below: Mask | null) {
  const [name, ...rest] = path;
  if (name === undefined) return;
  const leaf = rest.length === 0;
  const had = into.get(name);
  if (into.has(name) && had === null) return;
  if (leaf && below === null) {
    into.set(name, null);
    return;
  }
  const next = had ?? new Map<string, Mask | null>();
  into.set(name, next);
  if (leaf && below) for (const [field, sub] of below) add(next, [field], sub);
  else add(next, rest, below);
}

// The first field the mask names that the schema doesn't have, as a path.
export function unknownField(mask: Mask, schema: Schema, at = ""): string | null {
  for (const [name, below] of mask) {
    const path = at ? `${at}.${name}` : name;
    if (name === "*") continue;
    const field = schema[name];
    if (field === undefined) return path;
    if (below === null) continue;
    if (field === true) return `${path}.${[...below.keys()][0] ?? ""}`;
    const unknown = unknownField(below, field, path);
    if (unknown) return unknown;
  }
  return null;
}

// The answer with only what the mask selects. Arrays keep every element.
export function project(value: unknown, mask: Mask | null): unknown {
  if (mask === null || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => project(item, mask));
  const all = mask.get("*");
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    if (mask.has(name)) out[name] = project(field, mask.get(name) ?? null);
    else if (mask.has("*")) out[name] = project(field, all ?? null);
  }
  return out;
}
