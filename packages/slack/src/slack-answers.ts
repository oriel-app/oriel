// Slack's MCP server's answers, read (OA-277): each tool answers with
// Markdown meant for a model, as one string under a key of a JSON object in
// a text block, with no structured content. Each reader here takes one
// tool's answer, as recorded in fixtures/slack-mcp/real-*.json, and gives
// the Web API's shape the source already checks. Anything it doesn't
// recognise stops the sync (`ServerUnreadable`), naming the tool, never the
// answer: the index stays as it was.
//
// A message's text is the source's, and may hold anything, such as a line
// that reads like the next message's header. Where an answer counts what
// it lists, the count must match what was read; elsewhere each message's
// time must match its `ts`, and the `ts`s must run in order, so text that
// only looks like a message is refused, not read as one.
import { ServerUnreadable } from "@oriel/core";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tsShape = /^[0-9]{10}\.[0-9]{6}$/;
const userShape = /^[UBW][A-Z0-9]{2,20}$/;
const channelShape = /^[CG][A-Z0-9]{2,20}$/;

// The Markdown under `key` of an answer's JSON.
export function markdownOf(tool: string, body: unknown, key: string): string {
  if (!isObject(body) || typeof body[key] !== "string")
    throw new ServerUnreadable(`${tool} answered without its ${key}`);
  return body[key];
}

// The cursor a page's words give, or "" on the last. One that says more
// remain but gives no way to them can't be read.
function cursorOf(tool: string, words: string, more: RegExp, last: RegExp): string {
  const given = /cursor: [`"]([A-Za-z0-9+/=_-]{1,500})[`"]/.exec(words)?.[1];
  if (given) return given;
  if (more.test(words)) throw new ServerUnreadable(`${tool} said more remain, with no way to them`);
  if (!last.test(words)) throw new ServerUnreadable(`${tool} didn't say whether more remain`);
  return "";
}

// A person's profile, from `slack_read_user_profile`'s lines, each at its
// place: "User ID: U0…", "Username: …", "Display Name: …", "Real Name: …",
// then the rest. A value is one line; a field Oriel reads that comes again
// later, as text a person set could try, leaves the profile unread.
export function profileOf(
  tool: string,
  body: unknown,
): { id: string; display_name: string; real_name: string } {
  const lines = markdownOf(tool, body, "result").split("\n");
  const at = (i: number, name: string) => {
    const line = lines[i] ?? "";
    if (!line.startsWith(`${name}:`)) throw new ServerUnreadable(`${tool} didn't give its ${name}`);
    return line.slice(name.length + 1).trim();
  };
  const id = at(0, "User ID");
  at(1, "Username");
  const display = at(2, "Display Name");
  const real = at(3, "Real Name");
  if (!userShape.test(id)) throw new ServerUnreadable(`${tool} didn't say who it is`);
  if (lines.slice(4).some((line) => /^(User ID|Username|Display Name|Real Name):/.test(line)))
    throw new ServerUnreadable(`${tool} gave a field twice`);
  return { id, display_name: display, real_name: real };
}

// The person's channels, from `slack_list_user_channels`' Markdown, read
// line by line, each field at its place: a heading that counts them, then a
// section each, "### #name", "- **ID:**", "- **Type:**", an optional "-
// **Purpose:**" whose text may run on, and "- **Archived:**", then a blank
// line; last, where more remain, "---" and the cursor. A purpose with a
// line like a field or a section, as a person could write, leaves the
// answer unread: no field ever comes from one.
export function channelsOf(
  tool: string,
  body: unknown,
): {
  channels: { id: string; name: string; is_archived: boolean }[];
  next: string;
} {
  const lines = markdownOf(tool, body, "result").split("\n");
  const unread = (why: string) => new ServerUnreadable(`${tool} ${why}`);
  const head =
    /^## My Channels \(showing ([0-9]+)(?: of [0-9]+ total|(, more results available))\)$/.exec(
      lines[0] ?? "",
    );
  if (!head || lines[1] !== "") throw unread("answered in a way Oriel can't read");
  const field = /^- \*\*(ID|Type|Purpose|Archived):\*\* /;
  const channels: { id: string; name: string; is_archived: boolean }[] = [];
  let i = 2;
  const take = (name: string) => {
    const line = lines[i] ?? "";
    const prefix = `- **${name}:** `;
    if (!line.startsWith(prefix)) throw unread(`listed a channel without its ${name}`);
    i += 1;
    return line.slice(prefix.length);
  };
  while ((lines[i] ?? "").startsWith("### #")) {
    const name = /^### #([^\s#]{1,80})$/.exec(lines[i] ?? "")?.[1];
    if (!name) throw unread("listed a channel Oriel can't name");
    i += 1;
    const id = take("ID");
    take("Type");
    if ((lines[i] ?? "").startsWith("- **Purpose:** ")) {
      i += 1;
      // Its text runs on to the line before "- **Archived:**": none of it
      // may read as a field or a section.
      while (!(lines[i] ?? "").startsWith("- **Archived:** ")) {
        if (i >= lines.length || field.test(lines[i] ?? "") || (lines[i] ?? "").startsWith("### #"))
          throw unread("listed a channel whose purpose reads like its fields");
        i += 1;
      }
    }
    const archived = take("Archived");
    if ((archived !== "Yes" && archived !== "No") || lines[i] !== "")
      throw unread("listed a channel Oriel can't read");
    i += 1;
    if (!channelShape.test(id)) throw unread("listed a channel without its ID");
    channels.push({ id, name, is_archived: archived === "Yes" });
  }
  // Last, where more remain, the cursor; then nothing.
  let next = "";
  if (head[2]) {
    const cursor =
      lines[i] === "---"
        ? /^Pagination: More results available\. Use cursor: "([A-Za-z0-9+/=_-]{1,500})"$/.exec(
            lines[i + 1] ?? "",
          )?.[1]
        : undefined;
    if (!cursor) throw unread("said more remain, with no way to them");
    next = cursor;
    i += 2;
  }
  if (lines.slice(i).some((line) => line !== ""))
    throw unread("answered in a way Oriel can't read");
  if (channels.length !== Number(head[1])) throw unread("listed channels Oriel can't count");
  if (new Set(channels.map((each) => each.id)).size !== channels.length)
    throw unread("listed a channel twice");
  return { channels, next };
}

// A message as the Web API gives it, as far as the server says: its `ts`,
// author, text, and its thread's replies and latest reply where it has one.
export type ReadMessage = {
  ts: string;
  user: string;
  text: string;
  subtype?: "channel_join";
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
};

// A time as the server writes one, "2026-10-31 13:36:28 PDT": its wall
// clock in seconds since the epoch as if it were UTC, and its zone's name.
function wallOf(time: string): { seconds: number; zone: string } | null {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) ([A-Z]{1,6}|[+-]\d\d(?::?\d\d)?)$/.exec(
    time,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone = ""] = m;
  return {
    seconds:
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000,
    zone,
  };
}

// The offset of a time's zone from UTC, from a `ts` it's the time of: whole
// quarter hours, or null when they can't be the same moment.
function offsetOf(time: string, ts: string): { offset: number; zone: string } | null {
  const wall = wallOf(time);
  if (!wall) return null;
  const offset = wall.seconds - Math.floor(Number(ts));
  return offset % 900 === 0 && Math.abs(offset) <= 14 * 3600 ? { offset, zone: wall.zone } : null;
}

// A message with what its thread line says: "Thread: 4 replies (latest:
// 2026-10-31 13:39:10 PDT)". The latest reply's `ts` comes from its time,
// to the second, which is all Oriel orders it by, in its zone's offset as
// the page's headers give it. A zone none of them is in, as PST on a page
// all PDT, gives no offset: the reply's `ts` is left for the caller to read.
function threaded(
  tool: string,
  message: ReadMessage,
  text: string,
  zones: ReadonlyMap<string, number>,
): ReadMessage {
  const line = /\nThread: ([0-9]+) repl(?:y|ies) \(latest: ([^)]+)\)$/.exec(text);
  if (!line) return { ...message, text };
  const latest = wallOf(line[2] ?? "");
  if (!latest)
    throw new ServerUnreadable(`${tool} gave a thread's latest reply at a time Oriel can't read`);
  const offset = zones.get(latest.zone);
  return {
    ...message,
    text: text.slice(0, line.index),
    thread_ts: message.ts,
    reply_count: Number(line[1]),
    ...(offset === undefined
      ? {}
      : { latest_reply: `${String(latest.seconds - offset).padStart(10, "0")}.000000` }),
  };
}

// A message Slack posted for a person joining the channel, as the server
// shows it: as the Web API's `channel_join`, which isn't anyone's message.
const joined = (message: ReadMessage) =>
  new RegExp(`^<@${message.user}(?:\\|[^>]*)?> has joined the channel$`).test(message.text)
    ? { ...message, subtype: "channel_join" as const }
    : message;

// A channel's messages, newest first, from `slack_read_channel`'s Markdown:
// "Channel: #name (C0…)", then each message under its header, "=== Message
// from Name <email> (U0…) at <time> ===", with its "Message TS:" line. Its
// channel must be the one asked; each header's time must be its `ts`'s, and
// each `ts` older than the last.
export function historyOf(
  tool: string,
  body: unknown,
  channel: string,
): {
  name: string;
  messages: ReadMessage[];
  // Each message's author and time as its header gives them, for
  // `conciseAgrees`.
  heads: { author: string; time: string; text: string }[];
  next: string;
} {
  const words = markdownOf(tool, body, "messages");
  const paging = markdownOf(tool, body, "pagination_info");
  const top = /^Channel: #([^\s#]{1,80}) \(([A-Z0-9]+)\)(?:\n|$)/.exec(words);
  if (!top || top[2] !== channel)
    throw new ServerUnreadable(`${tool} answered for another channel than the one asked`);
  const header =
    /^=== Message from (.{1,200}?) \(([A-Z0-9]{3,22})\) at ([^\n=]{8,40}) === ?\nMessage TS: ([0-9]{10}\.[0-9]{6})\n/gm;
  const found = [...words.slice(top[0].length).matchAll(header)];
  const rest = words.slice(top[0].length);
  if (rest.trim() !== "" && (found.length === 0 || rest.slice(0, found[0]?.index).trim() !== ""))
    throw new ServerUnreadable(`${tool} answered in a way Oriel can't read`);
  let last = Infinity;
  const zones = new Map<string, number>();
  const placed = found.map((m, i) => {
    const [all, , user = "", time = "", ts = ""] = m;
    const end = found[i + 1]?.index ?? rest.length;
    const text = rest.slice((m.index ?? 0) + all.length, end).replace(/\n+$/, "");
    const zone = offsetOf(time, ts);
    if (!userShape.test(user) || !tsShape.test(ts) || !zone || Number(ts) >= last)
      throw new ServerUnreadable(`${tool} listed a message Oriel can't place`);
    if ((zones.get(zone.zone) ?? zone.offset) !== zone.offset)
      throw new ServerUnreadable(`${tool} listed messages Oriel can't place`);
    zones.set(zone.zone, zone.offset);
    last = Number(ts);
    return { ts, user, text };
  });
  const messages = placed.map((each) => joined(threaded(tool, each, each.text, zones)));
  const heads = found.map(([, author = "", , time = ""], i) => ({
    author,
    time,
    text: messages[i]?.text ?? "",
  }));
  const next = cursorOf(
    tool,
    paging,
    /There are more messages available/i,
    /There are no more messages available/i,
  );
  return { name: top[1] ?? "", messages, heads, next };
}

// The `ts` just after one, which a read's `latest`, never inclusive, takes
// to end at that message.
export const justAfter = (ts: string): string => {
  const micros = BigInt(ts.replace(".", "")) + 1n;
  const digits = String(micros).padStart(16, "0");
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
};

// Whether the same messages, read again in the concise format, "Name
// <email>: text [time]" each, line up with a page's messages, author by
// author, time by time and text by text. A header a message's text made up
// can't also pass in the concise format: there it's part of its real
// author's text, so the two part where it is.
export function conciseAgrees(
  tool: string,
  body: unknown,
  channel: string,
  heads: readonly { author: string; time: string; text: string }[],
): void {
  const words = markdownOf(tool, body, "messages");
  const top = `Channel: #`;
  const head = /^Channel: #[^\s#]{1,80} \(([A-Z0-9]+)\)(?:\n\n|$)/.exec(words);
  if (!words.startsWith(top) || !head || head[1] !== channel)
    throw new ServerUnreadable(`${tool} answered for another channel than the one asked`);
  let at = head[0].length;
  heads.forEach(({ author, time, text }, i) => {
    const start = `${author}: `;
    const end = ` [${time}]`;
    const last = i === heads.length - 1;
    if (!words.startsWith(start, at))
      throw new ServerUnreadable(`${tool} listed messages that don't agree`);
    const close = last ? words.length - end.length : words.indexOf(`${end}\n\n`, at + start.length);
    // Each message's text the same in both: a boundary one made up would
    // move text from one message to another in one of them.
    if (
      close < at + start.length ||
      !words.startsWith(end, close) ||
      words.slice(at + start.length, close).trimEnd() !== text.trimEnd()
    )
      throw new ServerUnreadable(`${tool} listed messages that don't agree`);
    at = close + end.length + (last ? 0 : 2);
  });
  if (at !== words.length) throw new ServerUnreadable(`${tool} listed messages that don't agree`);
}

// A message's thread, from `slack_read_thread`'s Markdown: the message,
// "=== THREAD PARENT MESSAGE ===", then "=== THREAD REPLIES (N total) ===",
// and "--- Reply i of N ---" for each, each with "From:", "Time:" and
// "Message TS:" lines. The replies must be N, in order, each numbered; the
// message must be the one asked.
export function threadOf(
  tool: string,
  body: unknown,
  ts: string,
): { messages: ReadMessage[]; next: string } {
  const words = markdownOf(tool, body, "messages");
  const paging = markdownOf(tool, body, "pagination_info");
  const one =
    /From: (.{1,200}?) \(([A-Z0-9]{3,22})\)\nTime: ([^\n]{8,40})\nMessage TS: ([0-9]{10}\.[0-9]{6})\n/y;
  const read = (at: number) => {
    one.lastIndex = at;
    const m = one.exec(words);
    if (!m) throw new ServerUnreadable(`${tool} listed a message Oriel can't place`);
    const [all, , user = "", time = "", stamp = ""] = m;
    if (!userShape.test(user) || !offsetOf(time, stamp))
      throw new ServerUnreadable(`${tool} listed a message Oriel can't place`);
    return { ts: stamp, user, end: at + all.length };
  };
  const parentHead = "=== THREAD PARENT MESSAGE ===\n";
  if (!words.startsWith(parentHead))
    throw new ServerUnreadable(`${tool} answered without its message`);
  const parent = read(parentHead.length);
  if (parent.ts !== ts) throw new ServerUnreadable(`${tool} answered for another message`);
  // The server's own lines, which no message's text may hold: one that
  // does could pass for a reply, so the thread can't be read.
  const marks =
    words.match(
      /^(?:=== THREAD [A-Z ]+(?:\([0-9]+ total\) )?===|--- Reply [0-9]+ of [0-9]+ ---)$/gm,
    ) ?? [];
  const head = /\n\n=== THREAD REPLIES \(([0-9]+) total\) ===\n/.exec(words);
  const total = head ? Number(head[1]) : 0;
  if (marks.length !== 1 + (head ? 1 + total : 0))
    throw new ServerUnreadable(`${tool} listed replies Oriel can't count`);
  const parentText = words.slice(parent.end, head?.index ?? words.length).replace(/\n+$/, "");
  const replies: ReadMessage[] = [];
  let at = head ? head.index + head[0].length : words.length;
  for (let i = 1; i <= total; i++) {
    const label = `\n--- Reply ${i} of ${total} ---\n`;
    if (!words.startsWith(label, at))
      throw new ServerUnreadable(`${tool} listed replies Oriel can't count`);
    const reply = read(at + label.length);
    const end =
      i < total
        ? words.indexOf(`\n\n--- Reply ${i + 1} of ${total} ---\n`, reply.end)
        : words.length;
    if (end < 0) throw new ServerUnreadable(`${tool} listed replies Oriel can't count`);
    replies.push({
      ts: reply.ts,
      user: reply.user,
      text: words.slice(reply.end, end).replace(/\n+$/, ""),
      thread_ts: ts,
    });
    at = end + 1;
  }
  const next = cursorOf(
    tool,
    paging,
    /There are more messages in this thread/i,
    /There are no more messages in this thread/i,
  );
  return {
    messages: [{ ts: parent.ts, user: parent.user, text: parentText, thread_ts: ts }, ...replies],
    next,
  };
}

// A channel's address, from `slack_search_channels`' Markdown: under a
// heading that counts them, each result's "Name: #…" and its one
// "Permalink: [link](https://<workspace>.slack.com/archives/C0…)" line. A
// purpose that holds a line like those leaves the answer unread.
export function searchedChannelsOf(
  tool: string,
  body: unknown,
): { id: string; name: string; workspace: string }[] {
  const words = markdownOf(tool, body, "results");
  const counted = /^## Channels \(([0-9]+) results?\)$/m.exec(words);
  if (!counted) {
    if (/^## Channels\b/m.test(words) || /^### Result /m.test(words))
      throw new ServerUnreadable(`${tool} answered in a way Oriel can't read`);
    return [];
  }
  const blocks = words
    .slice(counted.index)
    .split(/^### Result [0-9]+ of [0-9]+$/m)
    .slice(1);
  if (blocks.length !== Number(counted[1]))
    throw new ServerUnreadable(`${tool} listed channels Oriel can't count`);
  // Each result's lines in the server's order, each at its place: "Name:",
  // "Creator:" and "Created:" where given, a "Purpose:" whose text may run
  // on, then "Permalink:", "Is Archived:" and "Channel Type:", and nothing
  // after but blank lines and "---". A purpose with a line like one of
  // them leaves the answer unread: no field ever comes from one.
  const label = /^(Name|Creator|Created|Purpose|Permalink|Is Archived|Channel Type):/;
  return blocks.map((block) => {
    const lines = block.split("\n");
    const unread = () => new ServerUnreadable(`${tool} listed a channel Oriel can't place`);
    if (lines[0] !== "") throw unread();
    let i = 1;
    const name = /^Name: #([^\s#]{1,80})$/.exec(lines[i] ?? "")?.[1];
    if (!name) throw unread();
    i += 1;
    for (const optional of ["Creator: ", "Created: "])
      if ((lines[i] ?? "").startsWith(optional)) i += 1;
    if ((lines[i] ?? "").startsWith("Purpose: ")) {
      i += 1;
      while (!(lines[i] ?? "").startsWith("Permalink: ")) {
        if (i >= lines.length || label.test(lines[i] ?? "")) throw unread();
        i += 1;
      }
    }
    const link =
      /^Permalink: \[link\]\((https:\/\/[a-z0-9-]{1,63}\.slack\.com)\/archives\/([A-Z0-9]+)\)$/.exec(
        lines[i] ?? "",
      );
    const [, workspace = "", id = ""] = link ?? [];
    if (!link || !channelShape.test(id)) throw unread();
    i += 1;
    for (const optional of ["Is Archived: ", "Channel Type: "])
      if ((lines[i] ?? "").startsWith(optional)) i += 1;
    if (lines.slice(i).some((line) => line !== "" && line !== "---")) throw unread();
    return { id, name, workspace: `${workspace}/` };
  });
}
