import assert from "node:assert/strict";
import { type AccessSource, fixedAccess } from "./access.ts";
import type { Fixture } from "./fixture.ts";
import { type Answer, mcpServer, type McpServer } from "./server.ts";
import { standIn, standInToken } from "./stand-in.ts";

export const backlogId = "1BacklogSheet_abc-123";

export function smallFixture(): Fixture {
  return {
    spreadsheets: [
      {
        id: backlogId,
        name: "Team backlog",
        modifiedTime: "2026-11-01T10:00:00.000Z",
        tabs: [
          {
            sheetId: 0,
            title: "Backlog",
            frozenRows: 1,
            rows: [
              ["Key", "Title", "Status"],
              ["T-1", "First", "Done"],
              ["T-2", "Second", "To do"],
              ["T-3", "Third", ""],
            ],
          },
          {
            sheetId: 77,
            title: "Q3 plan",
            rowCount: 10,
            columnCount: 4,
            rows: [["Goal"], ["Ship it"]],
          },
        ],
      },
      {
        id: "1ViewOnly",
        name: "Budget (view only)",
        modifiedTime: "2026-10-01T10:00:00.000Z",
        canEdit: false,
        tabs: [{ sheetId: 0, title: "Sheet1", rows: [["Cost"], ["12"]] }],
      },
    ],
  };
}

export function overStandIn(fixture: Fixture = smallFixture(), source?: AccessSource) {
  const google = standIn(fixture, { now: () => "2026-11-05T12:00:00.000Z" });
  const server = mcpServer({ fetch: google.fetch, source: source ?? fixedAccess(standInToken) });
  return { google, server };
}

let next = 0;
export const request = (method: string, params?: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: ++next,
  method,
  ...(params ? { params } : {}),
});

export async function answerOf(server: McpServer, message: unknown): Promise<Answer> {
  const answer = await server.handle(message);
  assert.ok(answer, "an answer");
  return answer;
}

export type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const answer = await answerOf(server, request("tools/call", { name, arguments: args }));
  assert.ok("result" in answer, `a result, not ${JSON.stringify(answer)}`);
  return answer.result as ToolResult;
}

export async function called(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const result = await callTool(server, name, args);
  assert.equal(result.isError, undefined, result.content[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0]?.text ?? ""), result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}

export async function refused(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const result = await callTool(server, name, args);
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(result.structuredContent, undefined);
  assert.equal(result.content.length, 1);
  return result.content[0]?.text ?? "";
}
