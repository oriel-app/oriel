// Electron's fuses: switches compiled into its binary that turn features off
// before any code runs (decision 0039). They sit after a fixed sentinel as a
// version byte, a length byte, and one byte per fuse: "0" off, "1" on, "r"
// removed. This flips them in place, which is what Electron's own fuse tool
// does, without its package.
const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");

// Each fuse's position in version 1 of the wire.
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

// Where the fuse bytes start and how many there are.
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

// Sets each named fuse; a fuse this binary doesn't have, or has removed,
// stops the build rather than ship with it in an unknown state.
export function setFuses(binary: Uint8Array, wanted: Partial<Record<Fuse, boolean>>): void {
  const { at, length } = wire(binary);
  for (const [name, on] of Object.entries(wanted) as [Fuse, boolean][]) {
    const index = fuses[name];
    const value = index < length ? String.fromCharCode(binary[at + index] ?? 0) : "r";
    if (value !== "0" && value !== "1") throw new Error(`the ${name} fuse isn't in this binary`);
    binary[at + index] = (on ? "1" : "0").charCodeAt(0);
  }
}
