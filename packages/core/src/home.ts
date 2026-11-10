// Paths as the window and the agent see them: from the person's home folder
// as `~`, so no screen or tool result names the Mac's user (OA-315). Oriel
// keeps the real path; a `~/…` the person types or saves expands back.

// The home folder without a trailing slash; none for `/` or nothing, which
// no path is shown from.
const homeOf = (home: string): string | null => {
  const trimmed = home.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
};

// `/Users/x` → `~`, `/Users/x/notes` → `~/notes`; a path outside it, or a
// sibling such as `/Users/x2`, stays as it is.
export function homeRelative(path: string, home: string): string {
  const at = homeOf(home);
  if (at === null) return path;
  if (path === at || path === `${at}/`) return "~";
  return path.startsWith(`${at}/`) ? `~${path.slice(at.length)}` : path;
}

// `~` and `~/…` → the real path under home; anything else as it is.
export function homeExpanded(path: string, home: string): string {
  const at = homeOf(home);
  if (at === null || (path !== "~" && !path.startsWith("~/"))) return path;
  return `${at}${path.slice(1)}`;
}

// A `file:` link to a file under home as its path from `~`, decoded, as the
// agent reads a folder item's location; any other location as it is.
export function homeLocation(location: string, home: string): string {
  const url = URL.parse(location);
  if (!url || url.protocol !== "file:" || url.host !== "") return location;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return location;
  }
  const shown = homeRelative(path, home);
  return shown === path ? location : shown;
}

// Every mention of home in a line of text, as a CLI's log line: only where
// a path starts with it, so `/Users/x2` and `/private/Users/x` stay.
export function homeRelativeIn(text: string, home: string): string {
  const at = homeOf(home);
  if (at === null) return text;
  return text.split(at).reduce((out, part, i) => {
    if (i === 0) return part;
    const whole = !/[\w.~/-]$/.test(out) && (part === "" || /^[/\s"'`:,;)\]}>]/.test(part));
    return `${out}${whole ? "~" : at}${part}`;
  });
}
