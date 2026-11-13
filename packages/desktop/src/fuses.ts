// After a fixed sentinel: a version byte, a length byte, and one byte per fuse, "0" off, "1" on,
// "r" removed. Flipped in place, as Electron's own fuse tool does.
const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");

export const fuses = {
  runAsNode: 0,
  cookieEncryption: 1,
  nodeOptions: 2,
  inspectArguments: 3,
  asarIntegrity: 4,
  onlyLoadAppFromAsar: 5,
  browserV8Snapshot: 6,
  fileProtocolPrivileges: 7,
  wasmTrapHandlers: 8,
} as const;
export type Fuse = keyof typeof fuses;

function wire(binary: Uint8Array): { at: number; length: number } {
  const bytes = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  const found = bytes.indexOf(sentinel);
  if (found < 0) throw new Error("no fuse wire in this binary");
  if (bytes.indexOf(sentinel, found + 1) >= 0) throw new Error("more than one fuse wire");
  const version = bytes[found + sentinel.length];
  if (version !== 1) throw new Error(`fuse wire version ${version}, not 1`);
  return { at: found + sentinel.length + 2, length: bytes[found + sentinel.length + 1] ?? 0 };
}

export function readFuses(binary: Uint8Array): Partial<Record<Fuse, boolean>> {
  const { at, length } = wire(binary);
  const read: Partial<Record<Fuse, boolean>> = {};
  for (const [name, index] of Object.entries(fuses) as [Fuse, number][]) {
    const value = index < length ? String.fromCharCode(binary[at + index] ?? 0) : "r";
    if (value === "0" || value === "1") read[name] = value === "1";
  }
  return read;
}

export function setFuses(binary: Uint8Array, wanted: Partial<Record<Fuse, boolean>>): void {
  const { at, length } = wire(binary);
  for (const [name, on] of Object.entries(wanted) as [Fuse, boolean][]) {
    const index = fuses[name];
    const value = index < length ? String.fromCharCode(binary[at + index] ?? 0) : "r";
    if (value !== "0" && value !== "1") throw new Error(`the ${name} fuse isn't in this binary`);
    binary[at + index] = (on ? "1" : "0").charCodeAt(0);
  }
}
