// Message text arrives as Slack's markup: `&`, `<` and `>` escaped, and
// mentions, channels and links inside angle brackets. This reads it as plain
// text a person would: `<@U…>` as the person's name, `<#C…|name>` as
// `#name`, a link as its label and address. Bold, italics and the like are
// left as written; they read well enough as they are.

// `<…>` holds no `<` or `>` of its own: those arrive escaped.
const token = /<([^<>]*)>/g;

const unescape = (text: string) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// The user IDs a text mentions, in order, once each.
export function mentionedUsers(text: string): string[] {
  const ids = [...text.matchAll(token)].flatMap(([, inner = ""]) => {
    const match = /^@([UW][A-Z0-9]+)(?:\|.*)?$/.exec(inner);
    return match?.[1] ? [match[1]] : [];
  });
  return [...new Set(ids)];
}

// The text as plain text. `name` gives a mentioned person's name, or null
// when Oriel doesn't know them; then the mention's own label, or the ID.
export function plainText(text: string, name: (user: string) => string | null): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(token)) {
    out += unescape(text.slice(last, match.index));
    out += tokenText(match[1] ?? "", name);
    last = match.index + match[0].length;
  }
  return out + unescape(text.slice(last));
}

function tokenText(inner: string, name: (user: string) => string | null): string {
  const bar = inner.indexOf("|");
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? null : unescape(inner.slice(bar + 1));
  if (target.startsWith("@")) {
    const id = target.slice(1);
    return `@${name(id) ?? label ?? id}`;
  }
  if (target.startsWith("#")) return `#${label ?? target.slice(1)}`;
  if (target.startsWith("!")) {
    // `<!here>`, `<!channel>`, a user group (`<!subteam^S…|@ops>`, labelled
    // with its handle) or a date (`<!date^…|Oct 1>`, labelled with the text
    // to show where it can't be formatted).
    const [kind = ""] = target.slice(1).split("^");
    if (kind === "date") return label ?? "a date";
    if (kind === "subteam") return label ?? "@a group";
    return `@${label ?? kind}`;
  }
  const url = unescape(target);
  if (label === null || label === url) return url;
  if (url === `mailto:${label}`) return label;
  return `${label} (${url})`;
}
