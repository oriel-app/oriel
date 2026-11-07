// What a person sets on a Slack connection, and the live one a flag makes
// under `pnpm dev` (decision 0049). Slack has no steps to connect it in the
// window yet: that waits for an app anyone can install.
import {
  array,
  boolean,
  type LiveOf,
  object,
  optional,
  type OptionField,
  refine,
  string,
} from "@oriel/core";

const channel = refine(
  string,
  (name) => name.trim() !== "" && name.length <= 100,
  "expected a channel's name or ID",
);

// The public channels it reads, by name or ID, the only ones written to,
// typed in Settings; and whether Oriel may propose posts to them.
export const slackOptionFields = [
  {
    kind: "list",
    name: "channels",
    label: "Channels",
    about: "The public channels Oriel reads, by name, with commas between them.",
  },
  { kind: "read-only", name: "readOnly" },
] as const satisfies readonly OptionField[];
// Through Slack's server, a connection with none reads the person's first
// channels (decision 0059).
export const slackOptions = object({
  readOnly: optional(boolean),
  channels: optional(
    refine(
      array(channel),
      (list) => list.length > 0 && list.length <= 50,
      "expected 1 to 50 channels",
    ),
  ),
});

// A live connection from `.env`: the workspace the first user token in
// SLACK_USER_TOKENS is for, the person who authorized the app first (OA-22's
// `pnpm seed:slack --add`), reading the channels a flag names. Change sets a
// person approves post as that person, only in those channels (OA-28). Its
// identity is the workspace, which opening finds.
export const slackLive = {
  env: ["SLACK_USER_TOKENS"],
  connection(env, options) {
    const [token] = (env.SLACK_USER_TOKENS ?? "").split(/\s+/).filter(Boolean);
    if (!token) return { problem: "SLACK_USER_TOKENS must hold a user token in .env" };
    if (!token.startsWith("xoxp-"))
      return { problem: "SLACK_USER_TOKENS holds something that isn't a user token" };
    const channels = (options.channels ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (channels.length === 0)
      return { problem: "--channels names the channels live Slack reads, by name or ID" };
    return { identity: "", options: { channels }, secret: token };
  },
} satisfies LiveOf;
