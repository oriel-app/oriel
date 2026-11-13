// Read as the folder source reads a file: no link on the way to it, no second link to it,
// no pipe or device.
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { openChecked } from "../packages/folder/src/index.ts";

export async function readEnv(
  path: string,
): Promise<{ text: string | null } | { problem: string }> {
  const absolute = resolve(path);
  let expected: { dev: bigint; ino: bigint };
  try {
    expected = lstatSync(absolute, { bigint: true });
  } catch {
    return { text: null };
  }
  const opened = await openChecked(absolute, expected);
  if (opened.status === "vanished") return { text: null };
  if (opened.status === "forbidden") return { problem: `${path} can't be read` };
  if (opened.status === "changed")
    return { problem: `${path} is not a regular file with one link; it is refused` };
  try {
    return { text: await opened.handle.readFile("utf8") };
  } finally {
    await opened.handle.close();
  }
}
