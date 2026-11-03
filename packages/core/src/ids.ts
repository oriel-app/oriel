// Identifiers and time. Items are addressed by IDs qualified by their
// connection (`jira:SYN-12`, `folder:3f9a…`, `slack:C0A1B2C3D-1759309200.000100`),
// which are handles; an item's identity is the source's stable ID, kept
// beside it. Internal records use ULIDs. Time is canonical UTC ISO-8601 with
// milliseconds, so instants sort as strings.

// A connector's name in item IDs, such as `jira`. Core keeps no list of them:
// packages/sources holds the closed list, and checks each kind's own key.
export type SourceKind = string;
// An item's handle: its connection's prefix, then its key. The prefix is the
// kind for a kind's first connection (`jira:SYN-12`), and the kind and its
// number for a later one (`jira.2:ACME-4`) (decision 0049).
export type ItemId<K extends SourceKind = SourceKind> =
  | `${K}:${string}`
  | `${K}.${number}:${string}`;
export type Ulid = string & { readonly __brand: "Ulid" };
export type Instant = string & { readonly __brand: "Instant" };

// IDs reach generated code (the region's `.d.ts` and guest stubs), so every
// one has this shape: a short lowercase kind, a later connection's number
// (2 up, written without leading zeros, so one item has one handle), a colon,
// then a key of letters, digits, `.`, `_` and `-`. Each kind's own key shape
// is stricter, and no key carries text a person wrote.
const idShape = /^([a-z]{2,16})(?:\.([2-9]|[1-9][0-9]{1,3}))?:([A-Za-z0-9._-]{1,128})$/;

// What an ID names: `kind` is what the item is, and `prefix` whose it is,
// its connection: the kind, with any number.
export type ParsedItemId = { kind: SourceKind; prefix: string; key: string };

export function parseItemId(id: string): ParsedItemId | null {
  const match = idShape.exec(id);
  if (!match) return null;
  const [, kind = "", number, key = ""] = match;
  return { kind, prefix: number === undefined ? kind : `${kind}.${number}`, key };
}

// The kind a connection's prefix is of: `jira` for `jira` and `jira.2` alike.
export const kindOf = (prefix: string): SourceKind => prefix.split(".", 1)[0] ?? prefix;

// Whether a value is a connection's prefix, as the index keeps its source.
export const isPrefix = (value: string): boolean => parseItemId(`${value}:_`)?.prefix === value;

export function isItemId(value: string): value is ItemId {
  return parseItemId(value) !== null;
}

// Item IDs in one order everywhere: by kind, in `kinds` order and then any
// other by name, then by connection, then by key, where a key that ends in a
// number is ordered by what comes before it and then by that number (so
// SYN-9 comes before SYN-10). Code-unit comparisons only, so it is the same
// in every locale. The composition root gives the declared kinds.
export type ItemOrder = (a: string, b: string) => number;

export function itemOrder(kinds: readonly SourceKind[]): ItemOrder {
  const orderOf = (id: string): [number, string, number, string, number] => {
    const parsed = parseItemId(id);
    const at = parsed ? kinds.indexOf(parsed.kind) : -1;
    const kind = at === -1 ? kinds.length : at;
    const connection = parsed ? Number(parsed.prefix.slice(parsed.kind.length + 1) || 1) : 0;
    const key = parsed?.key ?? id;
    const digits = /[0-9]+$/.exec(key)?.[0] ?? "";
    // A key whose number is too long to compare as one sorts by its text.
    if (digits === "" || digits.length > 15) return [kind, parsed?.kind ?? "", connection, key, 0];
    return [kind, parsed?.kind ?? "", connection, key.slice(0, -digits.length), Number(digits)];
  };
  return (a, b) => {
    const [kindA, nameA, connectionA, stemA, numberA] = orderOf(a);
    const [kindB, nameB, connectionB, stemB, numberB] = orderOf(b);
    if (kindA !== kindB) return kindA - kindB;
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    if (connectionA !== connectionB) return connectionA - connectionB;
    if (stemA !== stemB) return stemA < stemB ? -1 : 1;
    if (numberA !== numberB) return numberA - numberB;
    // Equal numbers written differently, such as 01 and 1.
    return a === b ? 0 : a < b ? -1 : 1;
  };
}

// An item's handle, from its connection's prefix and its key.
export function itemId<K extends SourceKind>(prefix: K, key: string): ItemId<K> {
  const id: ItemId<K> = `${prefix}:${key}`;
  if (!isItemId(id)) throw new RangeError(`not a ${prefix} key: ${JSON.stringify(key)}`);
  return id;
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
