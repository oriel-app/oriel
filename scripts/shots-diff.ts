// `pnpm shots:diff <dirA> <dirB> [--tolerance <n>]`; exits 1 if any screenshot differs.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";

export type Image = { width: number; height: number; channels: number; pixels: Buffer };

const channelsOf: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function paeth(left: number, above: number, corner: number): number {
  const guess = left + above - corner;
  const [a, b, c] = [left, above, corner].map((v) => Math.abs(guess - v)) as [
    number,
    number,
    number,
  ];
  return a <= b && a <= c ? left : b <= c ? above : corner;
}

export function decode(png: Buffer): Image {
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const chunk = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = channelsOf[chunk[9] ?? -1] ?? 0;
      if (chunk[8] !== 8 || !channels || chunk[12] !== 0)
        throw new Error("only 8-bit, unpaletted, uninterlaced PNGs are read");
    }
    if (type === "IDAT") data.push(chunk);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++];
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0;
      const above = up[x] ?? 0;
      const corner = x >= channels ? (up[x - channels] ?? 0) : 0;
      let value = raw[at++] ?? 0;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += (left + above) >> 1;
      else if (filter === 4) value += paeth(left, above, corner);
      row[x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}

export function compare(
  a: Image,
  b: Image,
  tolerance = 0,
): { size: string } | { pixels: number; box: string } {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels)
    return { size: `${a.width}x${a.height} -> ${b.width}x${b.height}` };
  let pixels = 0;
  let [left, top, right, bottom] = [a.width, a.height, -1, -1];
  const stride = a.width * a.channels;
  for (let y = 0; y < a.height; y++) {
    const [rowA, rowB] = [a, b].map((image) => image.pixels.subarray(y * stride, (y + 1) * stride));
    if (rowA?.equals(rowB ?? Buffer.alloc(0))) continue;
    for (let x = 0; x < a.width; x++) {
      const at = x * a.channels;
      for (let k = 0; k < a.channels; k++)
        if (Math.abs((rowA?.[at + k] ?? 0) - (rowB?.[at + k] ?? 0)) > tolerance) {
          pixels++;
          [left, top] = [Math.min(left, x), Math.min(top, y)];
          [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
          break;
        }
    }
  }
  return { pixels, box: pixels ? `${left},${top}-${right},${bottom}` : "" };
}

const pngsUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".png"))
    .map((path) => relative(dir, join(dir, path)))
    .sort();

export type Noise = { scene: string; pixels: number; reason: string };

export const noiseFor = (path: string, noise: Noise[]): Noise | undefined =>
  noise
    .filter((entry) => basename(path).startsWith(entry.scene))
    .sort((a, b) => b.scene.length - a.scene.length)[0];

export function diffDirs(
  dirA: string,
  dirB: string,
  tolerance = 0,
  noise: Noise[] = [],
): { differ: string[]; noisy: string[] } {
  const inA = new Set(pngsUnder(dirA));
  const inB = new Set(pngsUnder(dirB));
  const differ: string[] = [];
  const noisy: string[] = [];
  for (const path of [...new Set([...inA, ...inB])].sort()) {
    if (!inB.has(path)) differ.push(`${path}\tonly in ${dirA}`);
    else if (!inA.has(path)) differ.push(`${path}\tonly in ${dirB}`);
    else {
      const [fileA, fileB] = [dirA, dirB].map((dir) => readFileSync(join(dir, path)));
      if (!fileA || !fileB || fileA.equals(fileB)) continue;
      const result = compare(decode(fileA), decode(fileB), tolerance);
      if ("size" in result) differ.push(`${path}\tsize ${result.size}`);
      else if (result.pixels) {
        const line = `${path}\t${result.pixels} pixels\t${result.box}`;
        const known = noiseFor(path, noise);
        if (!known) differ.push(line);
        else if (result.pixels <= known.pixels) noisy.push(`${line}\t${known.reason}`);
        else differ.push(`${line}\tover its noise limit of ${known.pixels}`);
      }
    }
  }
  return { differ, noisy };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { tolerance: { type: "string" } },
    allowPositionals: true,
  });
  const tolerance = Number(values.tolerance ?? 0);
  const [dirA, dirB] = positionals;
  if (!dirA || !dirB || positionals.length !== 2 || !(tolerance >= 0 && tolerance <= 255)) {
    console.error("usage: pnpm shots:diff [--tolerance <0-255>] <dirA> <dirB>");
    process.exit(2);
  }
  const noise = JSON.parse(
    readFileSync(new URL("shots-noise.json", import.meta.url), "utf8"),
  ) as Noise[];
  const { differ, noisy } = diffDirs(dirA, dirB, tolerance, noise);
  for (const line of differ) console.log(line);
  if (noisy.length) {
    console.log(`known noise (scripts/shots-noise.json), not counted:`);
    for (const line of noisy) console.log(`  ${line}`);
  }
  const total = new Set([...pngsUnder(dirA), ...pngsUnder(dirB)]).size;
  console.log(
    differ.length ? `${differ.length} of ${total} differ` : `${total - noisy.length} the same`,
  );
  process.exitCode = differ.length ? 1 : 0;
}
