// The Web API transport, against a fetch that answers from memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bearer, type ReadMethod, webApi } from "./api.ts";

type Sent = { url: string; headers: Record<string, string>; body: string };

function fakeFetch(answers: Response[]) {
  const sent: Sent[] = [];
  const send: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: String(init?.body),
    });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    return answer;
  };
  return { send, sent };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });

test("only read methods go out, whatever a cast says", async () => {
  const { send, sent } = fakeFetch([json({ ok: true })]);
  const api = webApi({ credential: bearer("xoxp-test"), fetch: send });
  await assert.rejects(api("chat.postMessage" as ReadMethod, { channel: "C0A", text: "hi" }));
  assert.equal(sent.length, 0);
});

test("a credential that fails sends nothing, and its message stays out of the error", async () => {
  const { send, sent } = fakeFetch([]);
  const api = webApi({
    credential: { headers: () => Promise.reject(new Error("xoxp-secret expired")) },
    fetch: send,
  });
  await assert.rejects(api("auth.test", {}), (error: Error) => !error.message.includes("xoxp"));
  assert.equal(sent.length, 0);
});
