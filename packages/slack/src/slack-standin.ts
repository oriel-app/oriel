// A stand-in for Slack's MCP server (OA-277), so Slack's support through a
// source server can be built and tried with no Slack workspace: it reports
// the real server's name and tool names, and answers each tool from
// Ferrowick, `fixtures/slack`, in memory, in the real server's shapes, as
// recorded in fixtures/slack-mcp/real-sync.json: Markdown meant for a
// model, under a key of a JSON object. The person it reads as is the
// fixture's first, who is in its picked channels. Writes change only this
// process's copy. Never published, never bundled. Served over stdio by
// packages/standin-mcp, and in memory to this package's tests:
// `@oriel/slack/standin`.
import { type StandInAnswer, type StandInTool, standInCalls } from "@oriel/core";
import { SlackError } from "./api.ts";
import { fixtureApi, loadSlackFixture, type SlackFixture } from "./fixture.ts";
import { slackTools } from "./slack-mcp.ts";

// Its JSON as a tool's text, as the server it stands in for answers.
const ok = (value: unknown): StandInAnswer => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
// One short sentence naming Slack's code, as a tool that failed answers.
const failed = (words: string): StandInAnswer => ({
  content: [{ type: "text", text: words }],
  isError: true,
});

// What it reports in its handshake, as the real one does.
export const slackInfo = { name: "Slack MCP", version: "standin" };

const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
});

// Ferrowick in memory, as the stand-in starts from.
export const standInWorkspace = (fixture: SlackFixture = loadSlackFixture()) => fixtureApi(fixture);

// Its tools as a caller in this process, for tests.
export const standInCaller = (tools: readonly StandInTool[] = slackStandIn()) =>
  standInCalls(tools);

// The tools it serves, and what each is. Each read is marked read-only, as
// the real server's are; each write isn't.
export function slackStandIn(
  fixture: SlackFixture = loadSlackFixture(),
  workspace = standInWorkspace(fixture),
): StandInTool[] {
  const self = fixture.users[0]?.id ?? "";
  // The channels the person is in: the fixture's picked ones, as they are
  // at each call, so a scene can take one away, as when the person leaves.
  const yours = { has: (id: string) => fixture.picked.includes(id) };
  // Through the fixture's own `fetch`, which writes as well as reads.
  const write = async (method: string, params: Record<string, string>) => {
    const response = await workspace.fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      body: new URLSearchParams(params),
    });
    return (await response.json()) as Record<string, unknown>;
  };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const page = (args: Record<string, unknown>) => ({
    ...(args.limit === undefined ? {} : { limit: String(args.limit) }),
    ...(typeof args.cursor === "string" && args.cursor ? { cursor: args.cursor } : {}),
  });

  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    readOnly: boolean,
    call: (args: Record<string, unknown>) => Promise<StandInAnswer>,
  ): StandInTool => ({
    name,
    description,
    inputSchema: schema(properties, required),
    annotations: { readOnlyHint: readOnly },
    call,
  });
  // A tool the real server has that Oriel never calls.
  const unused = (name: string, description: string, readOnly: boolean): StandInTool =>
    tool(name, description, {}, [], readOnly, async () => failed(`${name} isn't in the stand-in.`));

  // A person as a message's header names them: their display name, else
  // their real name; an app by its name.
  const nameOf = (message: Record<string, unknown>) => {
    const person = fixture.users.find((each) => each.id === message.user);
    if (person) return person.display_name || person.real_name;
    const bot = message.bot_profile as { name?: string } | undefined;
    return text(message.username) || text(bot?.name) || "app";
  };
  const authorOf = (message: Record<string, unknown>) =>
    text(message.user) || text(message.bot_id) || "B0STANDIN";
  // A `ts` as the server writes its time, in UTC.
  const timeOf = (ts: string) =>
    `${new Date(Math.floor(Number(ts)) * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
  // A message's text as the server shows it: its text, and its files.
  const bodyOf = (message: Record<string, unknown>) => {
    const files = Array.isArray(message.files)
      ? (message.files as { name?: string; title?: string }[]).map(
          (file) => `[File: ${file.title ?? file.name ?? "file"}]`,
        )
      : [];
    return [text(message.text), ...files].filter((part) => part !== "").join("\n");
  };
  // What the real server leaves out: a message that was deleted, and a
  // reply sent to the channel too, which its thread shows.
  const shown = (message: Record<string, unknown>) =>
    message.subtype !== "tombstone" && message.subtype !== "thread_broadcast";
  const joinedText = (message: Record<string, unknown>) =>
    message.subtype === "channel_join"
      ? `<@${authorOf(message)}|${nameOf(message)}> has joined the channel`
      : bodyOf(message);
  const more = (next: string, words: string, none: string) =>
    next ? `${words}, use cursor: \`${next}\`\n` : `${none}\n`;

  return [
    unused("slack_search_public", "Search messages and files in public channels.", true),
    unused("slack_search_public_and_private", "Search messages and files you can see.", true),
    tool(
      slackTools.search,
      "Find channels by name or description.",
      { keywords: { type: "array", items: string }, natural_language_query: string, limit: number },
      [],
      true,
      async (args) => {
        const words = Array.isArray(args.keywords) ? args.keywords.map(text) : [];
        const found = fixture.channels.filter((each) =>
          words.every((word) => each.name.includes(word.replace(/^#/, ""))),
        );
        return ok({
          results: `# Search Results for: \n\n## Channels (${found.length} results)\n${found
            .map(
              (each, i) =>
                `### Result ${i + 1} of ${found.length}\nName: #${each.name}\nPermalink: [link](${fixture.team.url}archives/${each.id})\nIs Archived: false\nChannel Type: public_channel\n\n---\n\n`,
            )
            .join("")}`,
          pagination_info: "End of results - No more pages available.\\n",
        });
      },
    ),
    unused("slack_search_users", "Find people by name, email or profile.", true),
    unused("slack_search_emojis", "Find the workspace's emoji.", true),
    tool(
      slackTools.history,
      "Read a channel's messages, newest first.",
      {
        channel_id: string,
        limit: number,
        cursor: string,
        oldest: string,
        latest: string,
        response_format: string,
      },
      ["channel_id"],
      true,
      async (args) => {
        const channel = text(args.channel_id);
        const listed = fixture.channels.find((each) => each.id === channel);
        if (!listed) return failed("execution_failed: channel_not_found");
        try {
          type Page = {
            messages: Record<string, unknown>[];
            response_metadata?: { next_cursor?: string };
          };
          const read = (more: Record<string, string>) =>
            workspace.api("conversations.history", { channel, ...more }) as Promise<Page>;
          // Before `latest`, never at it, as the real one reads: every page,
          // then as many as asked.
          let body: Page;
          if (typeof args.latest === "string") {
            const all: Record<string, unknown>[] = [];
            let cursor = "";
            do {
              const at = await read({ limit: "200", ...(cursor ? { cursor } : {}) });
              all.push(...at.messages);
              cursor = at.response_metadata?.next_cursor ?? "";
            } while (cursor);
            const before = all.filter((each) => shown(each) && text(each.ts) < String(args.latest));
            const most = Math.min(Math.max(Number(args.limit) || 100, 1), 100);
            body = {
              messages: before.slice(0, most),
              response_metadata: { next_cursor: before.length > most ? `before:${most}` : "" },
            };
          } else body = await read(page(args));
          const concise = args.response_format === "concise";
          const messages = body.messages.filter(shown).map((each) => {
            const ts = text(each.ts);
            if (concise) return `${nameOf(each)}: ${joinedText(each)} [${timeOf(ts)}]`;
            const thread =
              typeof each.reply_count === "number" && each.reply_count > 0
                ? `\nThread: ${each.reply_count} replies (latest: ${timeOf(text(each.latest_reply) || ts)})`
                : "";
            return `=== Message from ${nameOf(each)} (${authorOf(each)}) at ${timeOf(ts)} === \nMessage TS: ${ts}\n${joinedText(each)}${thread}`;
          });
          return ok({
            messages: [`Channel: #${listed.name} (${channel})`, ...messages].join("\n\n"),
            pagination_info: more(
              body.response_metadata?.next_cursor ?? "",
              "There are more messages available. To view the next page",
              "There are no more messages available.",
            ),
          });
        } catch (error) {
          if (error instanceof SlackError) return failed(`execution_failed: ${error.code}`);
          throw error;
        }
      },
    ),
    tool(
      slackTools.thread,
      "Read a message and its replies.",
      {
        channel_id: string,
        message_ts: string,
        limit: number,
        cursor: string,
        oldest: string,
        latest: string,
        response_format: string,
      },
      ["channel_id", "message_ts"],
      true,
      async (args) => {
        try {
          const body = (await workspace.api("conversations.replies", {
            channel: text(args.channel_id),
            ts: text(args.message_ts),
            ...page(args),
          })) as {
            messages: Record<string, unknown>[];
            response_metadata?: { next_cursor?: string };
          };
          const [parent, ...rest] = body.messages;
          if (!parent) return failed("execution_failed: thread_not_found");
          const replies = rest.filter((each) => each.subtype !== "tombstone");
          const one = (each: Record<string, unknown>) =>
            `From: ${nameOf(each)} (${authorOf(each)})\nTime: ${timeOf(text(each.ts))}\nMessage TS: ${text(each.ts)}\n${joinedText(each)}`;
          const listed = replies.length
            ? `\n\n=== THREAD REPLIES (${replies.length} total) ===\n${replies
                .map((each, i) => `\n--- Reply ${i + 1} of ${replies.length} ---\n${one(each)}`)
                .join("\n")}\n`
            : "\n";
          return ok({
            messages: `=== THREAD PARENT MESSAGE ===\n${one(parent)}${listed}`,
            pagination_info: more(
              body.response_metadata?.next_cursor ?? "",
              "There are more messages in this thread. To view the next page",
              "There are no more messages in this thread.",
            ),
          });
        } catch (error) {
          if (error instanceof SlackError) return failed(`execution_failed: ${error.code}`);
          throw error;
        }
      },
    ),
    unused("slack_read_canvas", "Read a canvas.", true),
    unused("slack_read_file", "Read a file shared in Slack.", true),
    tool(
      slackTools.profile,
      "Read a person's profile: yours unless user_id is given.",
      { user_id: string, include_locale: boolean, response_format: string },
      [],
      true,
      async (args) => {
        const user = text(args.user_id) || self;
        const person = fixture.users.find((each) => each.id === user);
        if (!person) return failed("execution_failed: user_not_found");
        return ok({
          result: `User ID: ${person.id}\nUsername: ${person.display_name || person.id}\nDisplay Name: ${person.display_name}\nReal Name: ${person.real_name}\nPronouns: \nTitle: \nOrganization Name: ferrowick\nStatus:  \nAdmin: No\nOwner: No\nBot: No\nRestricted: No\n`,
        });
      },
    ),
    unused("slack_list_channel_members", "List the people in a channel.", true),
    tool(
      slackTools.channels,
      "List the channels you're in.",
      { types: string, limit: number, cursor: string, format: string, exclude_archived: boolean },
      [],
      true,
      async (args) => {
        const all = fixture.channels.filter((each) => yours.has(each.id));
        const size = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
        const cursor = text(args.cursor);
        const at = cursor ? Number(/^at:([0-9]+)$/.exec(cursor)?.[1] ?? Number.NaN) : 0;
        if (!Number.isInteger(at)) return failed("execution_failed: invalid_cursor");
        const end = at + size;
        const shownNow = all.slice(at, end);
        const next = end < all.length ? `at:${end}` : "";
        const head = next
          ? `## My Channels (showing ${shownNow.length}, more results available)`
          : `## My Channels (showing ${shownNow.length} of ${all.length} total)`;
        return ok({
          result: `${head}\n\n${shownNow
            .map(
              (each) =>
                `### #${each.name}\n- **ID:** ${each.id}\n- **Type:** Public Channel\n- **Archived:** No\n\n`,
            )
            .join(
              "",
            )}${next ? `---\nPagination: More results available. Use cursor: "${next}"\n` : ""}`,
        });
      },
    ),
    unused("slack_get_reactions", "Read a message's reactions.", true),
    tool(
      slackTools.send,
      "Send a message to a channel, or a reply in a thread.",
      { channel_id: string, message: string, thread_ts: string, reply_broadcast: boolean },
      ["channel_id", "message"],
      false,
      async (args) => {
        const channel = text(args.channel_id);
        if (!yours.has(channel)) return failed("execution_failed: not_in_channel");
        const body = await write("chat.postMessage", {
          channel,
          // Markdown as the real server reads it: a mark escaped with a
          // backslash posts as itself.
          text: text(args.message).replace(/\\([!-/:-@[-`{-~])/g, "$1"),
          ...(text(args.thread_ts) ? { thread_ts: text(args.thread_ts) } : {}),
        });
        if (body.ok !== true) return failed(`execution_failed: ${text(body.error) || "failed"}`);
        const ts = text(body.ts);
        // As the real one answered a post (2026-11-07).
        return ok({
          message_link: `${fixture.team.url}archives/${channel}/p${ts.replace(".", "")}`,
          message_context: { message_ts: ts, channel_id: channel },
        });
      },
    ),
    unused("slack_schedule_message", "Schedule a message.", false),
    unused("slack_send_message_draft", "Draft a message for you to send.", false),
    unused("slack_add_reaction", "Add a reaction to a message.", false),
    unused("slack_create_canvas", "Create a canvas.", false),
    unused("slack_update_canvas", "Edit a canvas.", false),
  ];
}
