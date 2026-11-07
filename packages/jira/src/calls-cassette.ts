// Recorded calls of Atlassian's server's tools, and their answers, which
// tests replay in place of the server (OA-276): `fixtures/jira-mcp/`,
// recorded by `scripts/record-jira-mcp.ts` from the stand-in until Atlassian's
// own server is recorded. Each file says which it came from.
import { readFileSync } from "node:fs";
import {
  array,
  type Infer,
  object,
  record,
  string,
  type ToolAnswer,
  type ToolCall,
  type ToolCaller,
  unknown,
} from "@oriel/core";

const recordedCall = object({
  call: object({ tool: string, args: record(unknown) }),
  answer: unknown,
});
export const callsFile = object({
  // Where it was recorded from, such as the stand-in, and how.
  recorded: string,
  calls: array(recordedCall),
});
export type CallsFile = Infer<typeof callsFile>;
export type RecordedCall = Infer<typeof recordedCall>;

export const callsDir = new URL("../../../fixtures/jira-mcp/", import.meta.url);

// One of `fixtures/jira-mcp/`, checked.
export function loadCalls(name: string, dir: URL = callsDir): CallsFile {
  const read = callsFile(JSON.parse(readFileSync(new URL(name, dir), "utf8")) as unknown);
  if (!read.ok) throw new Error(`${name}: ${read.issues[0]?.path} ${read.issues[0]?.message}`);
  return read.value;
}

const keyOf = (call: ToolCall) => `${call.tool} ${JSON.stringify(sorted(call.args))}`;
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, each]) => each !== undefined)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([key, each]) => [key, sorted(each)]),
        )
      : value;

// Answers each call with the first recorded one alike, and throws for one
// the recording doesn't hold.
export function replayCalls(calls: readonly RecordedCall[]): ToolCaller {
  const answers = new Map<string, unknown>();
  for (const { call, answer } of calls) {
    const key = keyOf(call);
    if (!answers.has(key)) answers.set(key, answer);
  }
  return async (call) => {
    const key = keyOf(call);
    if (!answers.has(key)) throw new Error(`not in the recording: ${call.tool}`);
    return structuredClone(answers.get(key)) as ToolAnswer;
  };
}

// Passes calls through and keeps each, with its answer.
export function recordingCalls(inner: ToolCaller, into: RecordedCall[]): ToolCaller {
  return async (call) => {
    const answer = await inner(call);
    into.push(structuredClone({ call: { tool: call.tool, args: { ...call.args } }, answer }));
    return answer;
  };
}
