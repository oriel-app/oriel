// Which kind a server serves is a lookup, with no model call, so nothing a server says of itself can steer it.
import type { PickChoice } from "./connect.ts";
import type { IndexRecord } from "./source.ts";

// Oriel never adds a server to the person's agent itself.
export type SourceServer = {
  name: string;
  reports: string;
  at?: { url: string } | { command: string };
  reads: readonly string[];
  writes: readonly string[];
  instructions: string;
  keepsOptions?: true;
  picks?: readonly ServerPick[];
};

// Its list is read through the server's read tools, never a write tool.
export type ServerPick = {
  name: string;
  label: string;
  many?: true;
  most?: number;
  unpicked: string;
  list(
    read: ToolCaller,
    query: string,
    connection: { identity: string; options: Readonly<Record<string, unknown>> },
  ): Promise<{ choices: PickChoice[]; more: boolean }>;
  picked?(options: Readonly<Record<string, unknown>>): string[];
  into?(options: Readonly<Record<string, unknown>>, values: readonly string[]): unknown;
  unlisted?: string;
  known?(records: readonly IndexRecord[]): Iterable<readonly [string, string]>;
};

export function pickedOf(pick: ServerPick, options: Readonly<Record<string, unknown>>): string[] {
  if (pick.picked) return pick.picked(options);
  const value = options[pick.name];
  if (typeof value === "string") return value === "" ? [] : [value];
  return Array.isArray(value) ? value.filter((each) => typeof each === "string") : [];
}

export function pickedInto(
  picks: readonly ServerPick[],
  options: Readonly<Record<string, unknown>>,
  given: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(given).map(([name, value]) => {
      const pick = picks.find((each) => each.name === name);
      const values =
        Array.isArray(value) && value.every((each) => typeof each === "string") ? value : null;
      return [name, pick?.into && values ? pick.into(options, values) : value];
    }),
  );
}

// A server's answer is source content, which a picker draws as text.
export const mostChoices = 200;
const longestChoice = 200;

export function narrowed(
  choices: readonly (Pick<PickChoice, "value" | "name"> & Partial<PickChoice>)[],
  query: string,
  picked: readonly string[] = [],
): { choices: PickChoice[]; more: boolean } {
  const want = query.trim().toLowerCase();
  const fits = (each: { value: string; name: string }) =>
    want === "" ||
    each.name.toLowerCase().includes(want) ||
    each.value.toLowerCase().includes(want);
  const named = choices.filter((each) => each.value !== "" && each.name.trim() !== "");
  const fit = named.filter(fits);
  const listed = new Set(named.map((each) => each.value));
  const shown = [
    ...fit.slice(0, mostChoices),
    ...fit.slice(mostChoices).filter((each) => picked.includes(each.value)),
  ];
  const unlisted = [...new Set(picked)]
    .filter((value) => value !== "" && !listed.has(value))
    .map((value) => ({ value, name: value }));
  return {
    choices: [
      ...shown.map((each) => ({
        value: each.value,
        name: each.name.slice(0, longestChoice),
        count: each.count ?? null,
        updatedAt: each.updatedAt ?? null,
      })),
      ...unlisted.map((each) => ({
        ...each,
        count: null,
        updatedAt: null,
        unlisted: true as const,
      })),
    ],
    more: fit.length > mostChoices,
  };
}

export function unlistedNamed(
  listed: { choices: PickChoice[]; more: boolean },
  query: string,
  known: ReadonlyMap<string, string>,
): { choices: PickChoice[]; more: boolean } {
  const want = query.trim().toLowerCase();
  return {
    ...listed,
    choices: listed.choices.flatMap((each) => {
      if (!each.unlisted) return [each];
      const name = (known.get(each.value) ?? each.value).slice(0, longestChoice);
      const fits =
        want === "" || name.toLowerCase().includes(want) || each.value.toLowerCase().includes(want);
      return fits ? [{ ...each, name }] : [];
    }),
  };
}

// Nothing of it is trusted but as a key to look up.
export type FoundServer = {
  name: string;
  status: "connected" | "needs-auth" | "failed" | "pending" | "disabled";
  reports: string | null;
  url: string | null;
  command: string | null;
  tools: readonly string[];
  transport?: "http" | "sse";
  // A local one's command and arguments, never its environment, which may hold a secret.
  local?: { command: string; args: readonly string[] };
};

export type Recognized = { kind: string; known: SourceServer; found: FoundServer };

const urlKey = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};

// One whose entry gives its address is it only at that address: a server anywhere else could report
// the same name, and would then feed the kind.
export function serves(known: SourceServer, found: FoundServer): boolean {
  const at = known.at;
  const placed =
    at === undefined
      ? found.reports !== null && found.reports === known.reports
      : "url" in at
        ? found.url !== null && urlKey(found.url) !== null && urlKey(found.url) === urlKey(at.url)
        : found.command !== null && found.command === at.command;
  return placed && known.reads.every((tool) => found.tools.includes(tool));
}

export function recognize(
  found: readonly FoundServer[],
  known: readonly { kind: string; server: SourceServer }[],
): Recognized[] {
  return found.flatMap((each) => {
    const match = known.find(({ server }) => serves(server, each));
    return match ? [{ kind: match.kind, known: match.server, found: each }] : [];
  });
}

export type ToolCall = { tool: string; args: Readonly<Record<string, unknown>> };

// Source content, which only its connector's parser reads.
export type ToolAnswer = {
  content: readonly unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

// When `signal` aborts, a call still waiting is never sent, and one already out fails.
export type ToolCaller = (call: ToolCall, signal?: AbortSignal) => Promise<ToolAnswer>;

// Reads come from a process with only the server's read tools, writes from another with only its write tools:
// sync and replay never share a process.
export type ThroughServer = {
  known: SourceServer;
  found: FoundServer;
  read: ToolCaller;
  write: ToolCaller;
};

// Its message names the tool and what was wrong, never the answer.
export class ServerUnreadable extends Error {
  override name = "ServerUnreadable";
}

export const answerText = (answer: ToolAnswer): string =>
  answer.content
    .flatMap((block) =>
      typeof block === "object" && block !== null && "type" in block && block.type === "text"
        ? [String((block as { text?: unknown }).text)]
        : [],
    )
    .join("");

export function answerJson(tool: string, answer: ToolAnswer): unknown {
  if (typeof answer !== "object" || answer === null || !Array.isArray(answer.content))
    throw new ServerUnreadable(`${tool} answered with no content`);
  if (answer.structuredContent !== undefined && answer.structuredContent !== null)
    return answer.structuredContent;
  try {
    return JSON.parse(answerText(answer)) as unknown;
  } catch {
    throw new ServerUnreadable(`${tool} answered with text that isn't JSON`);
  }
}

// Every page is read before any is given, so a page it can't read stops the sync before anything lands.
export async function* readWhole<T>(pages: AsyncIterable<T>): AsyncGenerator<T> {
  const read: T[] = [];
  for await (const page of pages) read.push(page);
  yield* read;
}

export type StandInTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean };
  call(args: Record<string, unknown>): Promise<StandInAnswer>;
};

export type StandInAnswer = { content: { type: "text"; text: string }[]; isError?: true };

export const standInCalls =
  (tools: readonly StandInTool[]): ToolCaller =>
  async (call) => {
    const tool = tools.find((each) => each.name === call.tool);
    if (!tool) throw new Error(`the stand-in has no tool ${call.tool}`);
    return tool.call({ ...call.args });
  };
