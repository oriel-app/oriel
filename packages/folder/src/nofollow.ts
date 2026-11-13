// Between a listing and an open, the file or a directory above it can be swapped for a link,
// another file or a pipe; O_NONBLOCK makes a swapped-in pipe open and be refused, not hang.
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open, readlink, realpath } from "node:fs/promises";

// macOS 11+: refuse a link anywhere in the path. Node doesn't export it, and macOS refuses
// it combined with O_NOFOLLOW, which it includes.
const O_NOFOLLOW_ANY = 0x20000000;

const flags =
  process.platform === "darwin"
    ? constants.O_RDONLY | constants.O_NONBLOCK | O_NOFOLLOW_ANY
    : constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

export type Refused = { status: "vanished" } | { status: "changed" } | { status: "forbidden" };

export type Checked = { status: "open"; handle: FileHandle; stat: BigIntStats } | Refused;

export async function openChecked(
  path: string,
  expected: { dev: bigint; ino: bigint },
): Promise<Checked> {
  let handle: FileHandle;
  try {
    handle = await open(path, flags);
  } catch (error) {
    return refusal(error);
  }
  let refused: Refused;
  try {
    const stat = await handle.stat({ bigint: true });
    const same = stat.dev === expected.dev && stat.ino === expected.ino;
    if (!stat.isFile() || stat.nlink !== 1n || !same) refused = { status: "changed" };
    else if (!(await openedAt(handle, path))) refused = { status: "forbidden" };
    else return { status: "open", handle, stat };
  } catch (error) {
    await handle.close();
    return refusal(error);
  }
  await handle.close();
  return refused;
}

function refusal(error: unknown): Refused {
  if (isSystemFailure(error)) throw error;
  if (isMissing(error)) return { status: "vanished" };
  if (["ELOOP", "EMLINK", "EFTYPE"].includes(codeOf(error))) return { status: "changed" };
  return { status: "forbidden" };
}

// macOS's open already refused any link in the path.
async function openedAt(handle: FileHandle, path: string): Promise<boolean> {
  if (process.platform === "darwin") return true;
  if (process.platform === "linux") {
    try {
      return (await readlink(`/proc/self/fd/${handle.fd}`)) === path;
    } catch {
      // No /proc: fall back to resolving the path again.
    }
  }
  try {
    return (await realpath(path)) === path;
  } catch {
    return false;
  }
}

const codeOf = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");

export const isMissing = (error: unknown) => ["ENOENT", "ENOTDIR"].includes(codeOf(error));

// These throw, so a sync fails whole and marks nothing gone. Anything else is about one
// path; throwing on it would let one odd file break the whole folder for good.
const systemCodes = [
  "EMFILE",
  "ENFILE",
  "ENOMEM",
  "EIO",
  "EAGAIN",
  "EINTR",
  "EBUSY",
  "ETIMEDOUT",
  "ESTALE",
];

export function isSystemFailure(error: unknown): boolean {
  const code = codeOf(error);
  return code === "" || systemCodes.includes(code);
}
