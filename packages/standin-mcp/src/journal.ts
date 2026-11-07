// Stand-ins share their writes through a journal file, in dev, so a sync's
// process sees what a replay's process wrote (OA-276): each write call that
// worked is a line in it, and before every call a process makes the writes
// other processes added since, in order, to its own copy. Without one, a
// stand-in's writes change only its own process's copy.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { StandInTool } from "@oriel/jira/standin";

export function journaled(tools: StandInTool[], path: string): StandInTool[] {
  let applied = 0;
  const lines = () =>
    existsSync(path)
      ? readFileSync(path, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { tool: string; args: Record<string, unknown> })
      : [];
  const catchUp = async () => {
    const all = lines();
    for (const { tool, args } of all.slice(applied))
      await tools.find((each) => each.name === tool)?.call(args);
    applied = all.length;
  };
  return tools.map((tool) => ({
    ...tool,
    call: async (args) => {
      await catchUp();
      const answer = await tool.call(args);
      if (!tool.annotations.readOnlyHint && !answer.isError) {
        appendFileSync(path, `${JSON.stringify({ tool: tool.name, args })}\n`);
        applied += 1;
      }
      return answer;
    },
  }));
}
