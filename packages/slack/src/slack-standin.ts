// A stand-in for Slack's MCP server (OA-277), so Slack's support through a
// source server can be built and tried with no Slack workspace: it reports
// the real server's name and tool names, and answers each tool from
// Ferrowick, `fixtures/slack`, in memory, through the fixture's Web API,
// with what the Web API call it wraps returns. The person it reads as is
// the fixture's first, who is in its picked channels. Writes change only
// this process's copy. Never published, never bundled.
//
// Slack documents its tools' names and arguments, not their answers: those
// here are the parser's (`slack-mcp.ts`), to be checked against the real
// server's (packages/standin-mcp/README.md, "Re-recording"). Served over
// stdio by packages/standin-mcp, and in memory to this package's tests:
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
  const yours = new Set(fixture.picked);
  // A Web API call to the workspace in memory, as the real tool makes it:
  // its body less `ok`, or Slack's code for what it refused.
  const answer = async (
    method: string,
    params: Record<string, string>,
    shape: (body: Record<string, unknown>) => unknown = (body) => body,
  ): Promise<StandInAnswer> => {
    try {
      const { ok: _, ...body } = (await workspace.api(
        method as Parameters<typeof workspace.api>[0],
        params,
      )) as Record<string, unknown>;
      return ok(shape(body));
    } catch (error) {
      if (error instanceof SlackError) return failed(`Slack refused it: ${error.code}`);
      throw error;
    }
  };
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

  return [
    unused("slack_search_public", "Search messages and files in public channels.", true),
    unused("slack_search_public_and_private", "Search messages and files you can see.", true),
    unused("slack_search_channels", "Find channels by name or description.", true),
    unused("slack_search_users", "Find people by name, email or profile.", true),
    unused("slack_search_emojis", "Find the workspace's emoji.", true),
    tool(
      slackTools.history,
      "Read a channel's messages, newest first.",
      { channel_id: string, limit: number, cursor: string, oldest: string, latest: string },
      ["channel_id"],
      true,
      (args) => answer("conversations.history", { channel: text(args.channel_id), ...page(args) }),
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
      },
      ["channel_id", "message_ts"],
      true,
      (args) =>
        answer("conversations.replies", {
          channel: text(args.channel_id),
          ts: text(args.message_ts),
          ...page(args),
        }),
    ),
    unused("slack_read_canvas", "Read a canvas.", true),
    unused("slack_read_file", "Read a file shared in Slack.", true),
    tool(
      slackTools.profile,
      "Read a person's profile: yours unless user_id is given.",
      { user_id: string, include_locale: boolean },
      [],
      true,
      async (args) => {
        const user = text(args.user_id) || self;
        return answer("users.profile.get", { user }, (body) => ({
          user_id: user,
          team_id: fixture.team.id,
          workspace_url: fixture.team.url,
          ...body,
        }));
      },
    ),
    unused("slack_list_channel_members", "List the people in a channel.", true),
    tool(
      slackTools.channels,
      "List the channels you're in.",
      { channel_types: string, limit: number, cursor: string },
      [],
      true,
      async (args) => {
        const all = fixture.channels
          .filter((each) => yours.has(each.id))
          .map((each) => ({ id: each.id, name: each.name, is_archived: false, is_private: false }));
        const size = Math.min(Math.max(Number(args.limit) || 100, 1), 200);
        const cursor = text(args.cursor);
        const at = cursor ? Number(/^at:([0-9]+)$/.exec(cursor)?.[1] ?? Number.NaN) : 0;
        if (!Number.isInteger(at)) return failed("Slack refused it: invalid_cursor");
        const end = at + size;
        return ok({
          channels: all.slice(at, end),
          response_metadata: { next_cursor: end < all.length ? `at:${end}` : "" },
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
        if (!yours.has(channel)) return failed("Slack refused it: not_in_channel");
        const body = await write("chat.postMessage", {
          channel,
          text: text(args.message),
          ...(text(args.thread_ts) ? { thread_ts: text(args.thread_ts) } : {}),
        });
        if (body.ok !== true) return failed(`Slack refused it: ${text(body.error) || "failed"}`);
        const ts = text(body.ts);
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
