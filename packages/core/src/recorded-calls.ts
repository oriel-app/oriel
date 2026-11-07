// Recorded calls of a source server's tools, and their answers, which tests
// replay in place of the server (decision 0059): each connector's
// `fixtures/<kind>-mcp/`, recorded from its stand-in until its vendor's own
// server is recorded. Each file says which it came from.
import type { ToolAnswer, ToolCall, ToolCaller } from "./servers.ts";
import { array, type Infer, object, record, string, unknown } from "./validate.ts";

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

// A recording's JSON, checked; `name` says which in what it throws.
export function parseCalls(json: string, name: string): CallsFile {
  const read = callsFile(JSON.parse(json) as unknown);
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
