// Opening a file in the folder so that what opens is that file and nothing
// else (decision 0019). Between a listing and an open, anything in the folder
// can change: the file can be replaced by a link, by another file or by a
// pipe, or a directory above it by a link out of the folder. So:
//
// - The open follows no link. On macOS it refuses a link anywhere in the
//   path; elsewhere it refuses one as the last name, and the path check below
//   covers the rest.
// - It never blocks: a pipe swapped in opens and is then refused, rather
//   than waiting forever for a writer.
// - The open descriptor must be a regular file with one link and the device
//   and inode expected.
// - Where the system names a descriptor's file (Linux), that name must be the
//   path opened; elsewhere the path, resolved again, must be itself.
//
// The walk runs this before it lists a file, and a read before it reads one.
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open, readlink, realpath } from "node:fs/promises";

// macOS 11 and later: refuse a link anywhere in the path. Node doesn't export
// it, and macOS refuses it combined with O_NOFOLLOW, which it includes. Every
// macOS Node 26 supports has it.
const O_NOFOLLOW_ANY = 0x20000000;

const flags =
  process.platform === "darwin"
    ? constants.O_RDONLY | constants.O_NONBLOCK | O_NOFOLLOW_ANY
    : constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

export type Refused =
  // Nothing is at the path any more.
  | { status: "vanished" }
  // Something other than the expected file is: a link, another file, a pipe.
  | { status: "changed" }
  // The file is there, but Oriel may not read it.
  | { status: "forbidden" };

export type Checked = { status: "open"; handle: FileHandle; stat: BigIntStats } | Refused;

// Opens `path` as described above, expecting the file with `expected`'s
// device and inode. The caller closes the handle. A missing, swapped or
// unreadable file is a status; only a failure of the system itself (out of
// descriptors, an I/O error) throws.
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
  // A link where the open refuses one.
  if (["ELOOP", "EMLINK", "EFTYPE"].includes(codeOf(error))) return { status: "changed" };
  // Not permitted, a path too long for the system, and anything else about
  // this one path.
  return { status: "forbidden" };
}

// Whether the open descriptor is the file at `path`, reached with no link on
// the way. macOS's open already refused any link in the path.
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

// Failures of the system rather than of one path: out of descriptors or
// memory, an I/O error, a call interrupted or busy, a stale network mount, or
// an error with no code at all. These throw, so a sync fails whole and marks
// nothing gone. Anything else (not permitted, a path too long, a loop of
// links) is about one path, which is skipped or refused; throwing would let
// one odd file break the whole folder for good.
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
