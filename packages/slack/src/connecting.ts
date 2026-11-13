import { array, boolean, object, optional, type OptionField, refine, string } from "@oriel/core";

const channel = refine(
  string,
  (name) => name.trim() !== "" && name.length <= 100,
  "expected a channel's name or ID",
);

export const slackOptionFields = [
  {
    kind: "list",
    name: "channels",
    label: "Channels",
    about: "The public channels Oriel reads, by name, with commas between them.",
  },
  { kind: "read-only", name: "readOnly" },
] as const satisfies readonly OptionField[];
export const slackOptions = object({
  readOnly: optional(boolean),
  channels: optional(
    refine(array(channel), (list) => list.length <= 50, "expected at most 50 channels"),
  ),
});
