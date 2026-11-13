import type { ToolAnswer, ToolCall, ToolCaller } from "./servers.ts";
import { array, type Infer, object, record, string, unknown } from "./validate.ts";

const recordedCall = object({
  call: object({ tool: string, args: record(unknown) }),
  answer: unknown,
});
export const callsFile = object({
  recorded: string,
  calls: array(recordedCall),
});
export type CallsFile = Infer<typeof callsFile>;
export type RecordedCall = Infer<typeof recordedCall>;

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

export function recordingCalls(inner: ToolCaller, into: RecordedCall[]): ToolCaller {
  return async (call) => {
    const answer = await inner(call);
    into.push(structuredClone({ call: { tool: call.tool, args: { ...call.args } }, answer }));
    return answer;
  };
}
