// Message text arrives as Slack's markup: `&`, `<` and `>` escaped, and
// mentions, channels and links inside angle brackets. This reads it as plain
// text a person would: `<@U…>` as the person's name, `<#C…|name>` as
// `#name`, a link as its label and address. Bold, italics and the like are
// left as written; they read well enough as they are. It reads it in parts
// too, with each mention of a person or people, and each channel it names,
// marked, for the panel to set apart.

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

// The channels a text mentions with no name beside them, in order, once each.
export function unnamedChannels(text: string): string[] {
  const ids = [...text.matchAll(token)].flatMap(([, inner = ""]) => {
    const match = /^#([CG][A-Z0-9]+)\|?$/.exec(inner);
    return match?.[1] ? [match[1]] : [];
  });
  return [...new Set(ids)];
}

// A stretch of a message's text, and whether it names a person or people
// (someone, everyone here, a group), or a channel.
export type SlackPart = { text: string; names?: "person" | "channel" };

type Names = (user: string) => string | null;

// The text as plain text. `name` gives a mentioned person's name, or null
// when Oriel doesn't know them; then the mention's own label, or the ID.
// `channel` gives the name of a channel mentioned with none beside it.
export function plainText(text: string, name: Names, channel: Names = () => null): string {
  return textParts(text, name, channel)
    .map((part) => part.text)
    .join("");
}

// The text in parts, as `plainText` reads it, with each name its own part.
export function textParts(text: string, name: Names, channel: Names = () => null): SlackPart[] {
  const out: SlackPart[] = [];
  const said = (part: SlackPart) => {
    if (part.text === "") return;
    const last = out.at(-1);
    if (last && !last.names && !part.names) last.text += part.text;
    else out.push(part);
  };
  let last = 0;
  for (const match of text.matchAll(token)) {
    said({ text: unescape(text.slice(last, match.index)) });
    said(tokenPart(match[1] ?? "", name, channel));
    last = match.index + match[0].length;
  }
  said({ text: unescape(text.slice(last)) });
  return out;
}

function tokenPart(inner: string, name: Names, channel: Names): SlackPart {
  const bar = inner.indexOf("|");
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? null : unescape(inner.slice(bar + 1));
  if (target.startsWith("@")) {
    const id = target.slice(1);
    return { text: `@${name(id) ?? label ?? id}`, names: "person" };
  }
  if (target.startsWith("#")) {
    const id = target.slice(1);
    return { text: `#${label || channel(id) || id}`, names: "channel" };
  }
  if (target.startsWith("!")) {
    // `<!here>`, `<!channel>`, a user group (`<!subteam^S…|@ops>`, labelled
    // with its handle) or a date (`<!date^…|Oct 1>`, labelled with the text
    // to show where it can't be formatted).
    const [kind = ""] = target.slice(1).split("^");
    if (kind === "date") return { text: label ?? "a date" };
    if (kind === "subteam") return { text: label ?? "@a group", names: "person" };
    return { text: `@${label ?? kind}`, names: "person" };
  }
  const url = unescape(target);
  if (label === null || label === url) return { text: url };
  if (url === `mailto:${label}`) return { text: label };
  return { text: `${label} (${url})` };
}
