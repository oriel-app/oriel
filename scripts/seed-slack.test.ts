import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Call,
  parseScenario,
  type Person,
  type Scenario,
  seed,
  slackEnv,
  testWorkspace,
  withToken,
} from "./seed-slack.ts";

const scenario = (messages: Scenario["messages"], channel = "team"): string =>
  JSON.stringify({ channel, messages });

const people: Person[] = [
  { token: "xoxp-pm", user: "U1", names: ["Product manager", "Avery"] },
  { token: "xoxp-eng", user: "U2", names: ["Engineer ", "Jordan"] },
];

test("only the three Slack values are read, and errors never hold a value", () => {
  const env =
    "SLACK_CLIENT_ID=123.456\nSLACK_CLIENT_SECRET=s3cr3t\nSLACK_USER_TOKENS=xoxp-a xoxp-b\nJIRA_API_TOKEN=t0k3n\n";
  assert.deepEqual(slackEnv(env), {
    clientId: "123.456",
    clientSecret: "s3cr3t",
    tokens: ["xoxp-a", "xoxp-b"],
  });
  assert.deepEqual(slackEnv(null), { clientId: null, clientSecret: null, tokens: [] });
  const bad = slackEnv("SLACK_USER_TOKENS=xoxp-a xoxb-bot\n");
  assert.ok("error" in bad && !bad.error.includes("xoxb-bot"));
});

test("a token joins SLACK_USER_TOKENS once, and every other line is kept", () => {
  assert.equal(withToken("", "xoxp-a"), "SLACK_USER_TOKENS=xoxp-a\n");
  assert.equal(withToken("JIRA_EMAIL=x", "xoxp-a"), "JIRA_EMAIL=x\nSLACK_USER_TOKENS=xoxp-a\n");
  const env = "A=1\nSLACK_USER_TOKENS=xoxp-a\nB=2\n";
  assert.equal(withToken(env, "xoxp-b"), "A=1\nSLACK_USER_TOKENS=xoxp-a xoxp-b\nB=2\n");
  assert.equal(withToken(env, "xoxp-a"), env);
});

type Sent = { method: string; token: string | null; params: Record<string, string> };

// A workspace with the two people, in memory.
function fakeSlack(options: { team?: string; channels?: string[]; history?: object[] } = {}) {
  const sent: Sent[] = [];
  let ts = 0;
  const run: Call = async (method, token, params) => {
    sent.push({ method, token, params });
    const who = people.find((p) => p.token === token);
    switch (method) {
      case "auth.test":
        return { ok: true, user_id: who?.user, team_id: options.team ?? testWorkspace };
      case "users.profile.get":
        return {
          ok: true,
          profile: { title: who?.names[0], display_name: who?.names[1], real_name: who?.names[1] },
        };
      case "conversations.list":
        return {
          ok: true,
          channels: (options.channels ?? []).map((name, i) => ({ id: `C${i}`, name })),
        };
      case "conversations.create":
        return { ok: true, channel: { id: "CNEW" } };
      case "conversations.history":
        return { ok: true, messages: options.history ?? [{ subtype: "channel_join" }] };
      case "chat.postMessage":
        return { ok: true, ts: `${++ts}.0` };
      case "oauth.v2.access":
        return {
          ok: true,
          team: { id: options.team ?? testWorkspace },
          authed_user: { id: "U2", access_token: "xoxp-eng" },
        };
      default:
        return { ok: true };
    }
  };
  return { run, sent };
}

const conversation = parseScenario(
  scenario([
    { as: "Product manager", text: "Standup: {@Engineer}?" },
    { as: "Engineer", text: "On it", thread: 0 },
    { as: "Product manager", text: "Thanks" },
  ]),
) as Scenario;

test("it posts nothing unless every token is the test workspace's and the channel is empty", async () => {
  for (const options of [{ team: "TOTHER" }, { channels: ["team"], history: [{}] }]) {
    const { run, sent } = fakeSlack(options);
    await assert.rejects(seed(run, ["xoxp-pm", "xoxp-eng"], conversation, () => {}, 0));
    assert.ok(!sent.some((s) => s.method === "chat.postMessage"));
    // Nobody but the first poster joins a channel it refuses.
    assert.ok(
      sent.filter((s) => s.method === "conversations.join").every((s) => s.token === "xoxp-pm"),
    );
  }
});
