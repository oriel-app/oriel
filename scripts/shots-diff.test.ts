import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { compare, decode, diffDirs, paeth } from "./shots-diff.ts";

// A PNG of RGB rows, each row given its own filter, as an encoder may.
function png(width: number, rows: number[][], filters = rows.map(() => 0)): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    // Nothing here reads the CRC.
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows.length, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = rows.flatMap((row, y) => {
    const up = rows[y - 1] ?? row.map(() => 0);
    const filter = filters[y] ?? 0;
    const encoded = row.map((value, x) => {
      const left = x >= 3 ? (row[x - 3] ?? 0) : 0;
      const above = up[x] ?? 0;
      const corner = x >= 3 ? (up[x - 3] ?? 0) : 0;
      const predicted =
        [0, left, above, (left + above) >> 1, paeth(left, above, corner)][filter] ?? 0;
      return (value - predicted) & 255;
    });
    return [filter, ...encoded];
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const rows = [
  [10, 20, 30, 200, 100, 50],
  [12, 22, 33, 199, 90, 60],
  [250, 0, 7, 3, 9, 81],
];

test("every row filter decodes to the same pixels", () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const image = decode(
      png(
        2,
        rows,
        rows.map(() => filter),
      ),
    );
    assert.deepEqual([image.width, image.height, image.channels], [2, 3, 3]);
    assert.deepEqual([...image.pixels], rows.flat(), `filter ${filter}`);
  }
});

test("a difference is counted by pixel, boxed, and forgiven within the tolerance", () => {
  const changed = rows.map((row) => [...row]);
  (changed[1] as number[])[4] = 95;
  (changed[2] as number[])[0] = 200;
  const [a, b] = [decode(png(2, rows)), decode(png(2, changed, [1, 4, 3]))];
  assert.deepEqual(compare(a, a), { pixels: 0, box: "" });
  assert.deepEqual(compare(a, b), { pixels: 2, box: "0,1-1,2" });
  assert.deepEqual(compare(a, b, 5), { pixels: 1, box: "0,2-0,2" });
  assert.deepEqual(compare(a, decode(png(1, [[1, 2, 3]]))), { size: "2x3 -> 1x1" });
});

test("folders are matched by path, and only what differs is listed", () => {
  const root = mkdtempSync(join(tmpdir(), "oriel-shots-diff-"));
  try {
    for (const dir of ["a", "b"]) mkdirSync(join(root, dir, "broadsheet"), { recursive: true });
    const put = (path: string, image: Buffer) => writeFileSync(join(root, path), image);
    put("a/same.png", png(2, rows));
    put("b/same.png", png(2, rows, [2, 2, 2]));
    put("a/broadsheet/moved.png", png(2, rows));
    put("b/broadsheet/moved.png", png(2, [...rows].reverse()));
    put("a/gone.png", png(2, rows));
    put("b/new.png", png(2, rows));
    writeFileSync(join(root, "b", "notes.txt"), "not a shot");
    const [a, b] = [join(root, "a"), join(root, "b")];
    assert.deepEqual(diffDirs(a, b), [
      "broadsheet/moved.png\t4 pixels\t0,0-1,2",
      `gone.png\tonly in ${a}`,
      `new.png\tonly in ${b}`,
    ]);
    assert.deepEqual(diffDirs(a, a), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
