// Dropping things on a group or a thread adds them to the group. A browser
// hands a page links, text and files by name only (never a file's path); the
// server finds the items they name (packages/server/src/dropped.ts).
import type { GroupView } from "./view.ts";

export type Dropped = { links: string[]; files: string[] };

// What the server says a drop did.
export type DropReply = {
  group: GroupView;
  added: string[];
  refused: { what: string; why: string }[];
};

// The server takes at most this many of each.
const most = 50;

// The parts of a DataTransfer a drop reads, so it's tested without a DOM.
export type DropData = {
  types: readonly string[];
  getData(format: string): string;
  files: ArrayLike<{ name: string }>;
};

// Whether a drag carries anything a drop could add.
export const carries = (types: readonly string[]): boolean =>
  types.some((type) => type === "Files" || type === "text/uri-list" || type === "text/plain");

export function readDrop(data: DropData): Dropped {
  // A link list has one per line; lines starting with # are comments.
  const listed = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const text = data.getData("text/plain").trim();
  const links = [...listed];
  // Text that isn't one of the links already, such as a card's key and title.
  if (text !== "" && !listed.includes(text)) links.push(text);
  const files = Array.from(data.files, (file) => file.name);
  return { links: links.slice(0, most), files: files.slice(0, most) };
}

export const isEmpty = (dropped: Dropped): boolean =>
  dropped.links.length === 0 && dropped.files.length === 0;

// One sentence for the person: what was added, and what wasn't and why. Null
// when every dropped thing was added, since the group shows that itself.
export function dropNotice(reply: Pick<DropReply, "added" | "refused">): string | null {
  const [first, ...rest] = reply.refused;
  if (!first) return reply.added.length === 0 ? "That's already in this group." : null;
  const shown = first.what.length > 60 ? `${first.what.slice(0, 59)}…` : first.what;
  const more = rest.length > 0 ? ` ${rest.length} more couldn't be added either.` : "";
  return `Couldn't add “${shown}”: ${first.why}${more}`;
}
