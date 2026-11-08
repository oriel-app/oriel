// What a person sets on a Slack connection (decision 0049). Slack turns on
// through Slack's own MCP server in the person's agent (decision 0059), so
// nothing here asks for a token.
import { array, boolean, object, optional, type OptionField, refine, string } from "@oriel/core";

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
// Through Slack's server, a connection with none, or none left after the
// person unpicks them, reads the person's first channels (decision 0059).
export const slackOptions = object({
  readOnly: optional(boolean),
  channels: optional(
    refine(array(channel), (list) => list.length <= 50, "expected at most 50 channels"),
  ),
});
