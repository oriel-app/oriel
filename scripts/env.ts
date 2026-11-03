// Reads a .env a script is pointed at, as the folder source reads a file
// (decision 0019): no link on the way to it, no second link to it, no pipe
// or device. The evals' `--env` and `pnpm record:jira --env` both read
// through it, so a worktree without its own .env can use the main
// checkout's without copying or linking it.
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { openChecked } from "../packages/folder/src/index.ts";

// Null when nothing is there; no problem quotes the file.
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
