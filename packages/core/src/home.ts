// No screen or tool result names the Mac's user; Oriel keeps the real path.

const homeOf = (home: string): string | null => {
  const trimmed = home.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
};

// A sibling such as `/Users/x2` stays as it is.
export function homeRelative(path: string, home: string): string {
  const at = homeOf(home);
  if (at === null) return path;
  if (path === at || path === `${at}/`) return "~";
  return path.startsWith(`${at}/`) ? `~${path.slice(at.length)}` : path;
}

export function homeExpanded(path: string, home: string): string {
  const at = homeOf(home);
  if (at === null || (path !== "~" && !path.startsWith("~/"))) return path;
  return `${at}${path.slice(1)}`;
}

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

// Only where a path starts with it, so `/Users/x2` and `/private/Users/x` stay.
export function homeRelativeIn(text: string, home: string): string {
  const at = homeOf(home);
  if (at === null) return text;
  return text.split(at).reduce((out, part, i) => {
    if (i === 0) return part;
    const whole = !/[\w.~/-]$/.test(out) && (part === "" || /^[/\s"'`:,;)\]}>]/.test(part));
    return `${out}${whole ? "~" : at}${part}`;
  });
}
