// Identifiers and time. Items are addressed by source-qualified IDs
// (`jira:SYN-12`, `folder:3f9a…`), which are handles; an item's identity is
// the source's stable ID, kept beside it. Internal records use ULIDs. Time is canonical UTC
// ISO-8601 with milliseconds, so instants sort as strings.

// Adding a source here makes `keyShapes` below require its key shape.
export const sourceKinds = ["jira", "folder"] as const;
export type SourceKind = (typeof sourceKinds)[number];
export type ItemId<K extends SourceKind = SourceKind> = `${K}:${string}`;
export type Ulid = string & { readonly __brand: "Ulid" };
export type Instant = string & { readonly __brand: "Instant" };

// Keys reach generated code (the region's `.d.ts` and guest stubs), so each
// source's key shape is strict, and no key carries text a person wrote.

const keyShapes: Record<SourceKind, RegExp> = {
  jira: /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/,
  // A fixed-length hash of the folder's ID and the file's canonical relative
  // path (decision 0019): a file's name is its title, never its key.
  folder: /^[0-9a-f]{16}$/,
};

export function parseItemId(id: string): { source: SourceKind; key: string } | null {
  const at = id.indexOf(":");
  const source = sourceKinds.find((kind) => kind === id.slice(0, at));
  const key = id.slice(at + 1);
  if (!source || !keyShapes[source].test(key)) return null;
  return { source, key };
}

export function isItemId(value: string): value is ItemId {
  return parseItemId(value) !== null;
}

// Item IDs in one order everywhere: by source, then by key, where a key that
// ends in a number is ordered by what comes before it and then by that number
// (so SYN-9 comes before SYN-10). Code-unit comparisons only, so it is the
// same in every locale.
export function byItemId(a: string, b: string): number {
  const [sourceA, stemA, numberA] = orderOf(a);
  const [sourceB, stemB, numberB] = orderOf(b);
  if (sourceA !== sourceB) return sourceA - sourceB;
  if (stemA !== stemB) return stemA < stemB ? -1 : 1;
  if (numberA !== numberB) return numberA - numberB;
  // Equal numbers written differently, such as 01 and 1.
  return a === b ? 0 : a < b ? -1 : 1;
}

function orderOf(id: string): [number, string, number] {
  const parsed = parseItemId(id);
  const source = parsed ? sourceKinds.indexOf(parsed.source) : sourceKinds.length;
  const key = parsed?.key ?? id;
  const digits = /[0-9]+$/.exec(key)?.[0] ?? "";
  // A key whose number is too long to compare as one sorts by its text.
  if (digits === "" || digits.length > 15) return [source, key, 0];
  return [source, key.slice(0, -digits.length), Number(digits)];
}

export function itemId<K extends SourceKind>(source: K, key: string): ItemId<K> {
  if (!keyShapes[source].test(key))
    throw new RangeError(`not a ${source} key: ${JSON.stringify(key)}`);
  return `${source}:${key}`;
}

export function instant(date: Date): Instant {
  return date.toISOString() as Instant;
}

export function isInstant(value: string): value is Instant {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 48 bits of milliseconds then 80 random bits, Crockford base32. Time is passed
// in. Not monotonic within a millisecond: order records with an explicit
// sequence, not by ULID.
export function ulid(
  nowMs: number,
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): Ulid {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 2 ** 48 - 1)
    throw new RangeError(`bad ULID time: ${nowMs}`);
  if (random.length !== 10) throw new RangeError("ULID randomness must be 10 bytes");
  let time = "";
  for (let t = nowMs, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = crockford[t % 32] + time;
  let bits = random.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  let rest = "";
  for (let i = 0; i < 16; i++, bits >>= 5n) rest = crockford[Number(bits & 31n)] + rest;
  return (time + rest) as Ulid;
}

export function isUlid(value: string): value is Ulid {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);
}
