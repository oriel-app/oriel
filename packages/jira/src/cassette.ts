// Recorded REST exchanges, replayed in tests and evals so they run without the
// network. `scripts/record-jira.ts` records them from the live SYN.
import { array, type Infer, literal, number, object, string, union, unknown } from "@oriel/core";
import type { JiraRequest, JiraResponse, Transport } from "./transport.ts";

export const exchange = object({
  request: object({
    method: union(literal("GET"), literal("POST"), literal("PUT"), literal("DELETE")),
    path: string,
    body: unknown,
  }),
  response: object({ status: number, body: unknown }),
});
export const cassette = array(exchange);
export type Exchange = Infer<typeof exchange>;

const keyOf = (request: JiraRequest) =>
  `${request.method} ${request.path} ${JSON.stringify(request.body ?? null)}`;

// Answers each request with the first recorded exchange that matches it
// exactly, and throws for anything the cassette doesn't hold.
export function replay(exchanges: readonly Exchange[]): Transport {
  const answers = new Map<string, Exchange["response"]>();
  for (const { request, response } of exchanges) {
    const key = keyOf(request);
    if (!answers.has(key)) answers.set(key, response);
  }
  return async (request) => {
    const response = answers.get(keyOf(request));
    if (!response) throw new Error(`not in the cassette: ${request.method} ${request.path}`);
    return structuredClone(response);
  };
}

// Passes requests through and keeps each exchange.
export function recording<R extends JiraRequest>(
  inner: (request: R) => Promise<JiraResponse>,
  into: Exchange[],
): (request: R) => Promise<JiraResponse> {
  return async (request) => {
    const response = await inner(request);
    into.push(structuredClone({ request: { body: null, ...request }, response }));
    return response;
  };
}
