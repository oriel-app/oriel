import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  authorize,
  authorizeUrl,
  type Call,
  cast,
  codeFrom,
  parseScenario,
  type Person,
  resolve,
  type Scenario,
  seed,
  slackEnv,
  testWorkspace,
  withToken,
} from "./seed-slack.ts";

const manifest = JSON.parse(readFileSync(new URL("slack-app.json", import.meta.url), "utf8")) as {
  oauth_config: { redirect_urls: string[]; scopes: { user: string[] } };
};
const redirect = manifest.oauth_config.redirect_urls[0] ?? "";

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

test("the authorize link asks for the manifest's user scopes, in the test workspace", () => {
  const url = new URL(authorizeUrl("123.456"));
  assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(url.searchParams.get("user_scope"), manifest.oauth_config.scopes.user.join(","));
  assert.equal(url.searchParams.get("redirect_uri"), redirect);
  assert.equal(url.searchParams.get("team"), testWorkspace);
  assert.equal(url.searchParams.get("scope"), null);
});

test("a code is taken only from the redirect address", () => {
  assert.deepEqual(codeFrom(`  ${redirect}?code=abc&state=\n`), { code: "abc" });
  for (const text of [
    "abc",
    "https://example.com/oriel-slack?code=abc",
    `${redirect}/more?code=abc`,
    redirect,
  ])
    assert.ok("error" in codeFrom(text), text);
  const denied = codeFrom(`${redirect}?error=access_denied`);
  assert.ok("error" in denied && denied.error.includes("access_denied"));
});

test("a token joins SLACK_USER_TOKENS once, and every other line is kept", () => {
  assert.equal(withToken("", "xoxp-a"), "SLACK_USER_TOKENS=xoxp-a\n");
  assert.equal(withToken("JIRA_EMAIL=x", "xoxp-a"), "JIRA_EMAIL=x\nSLACK_USER_TOKENS=xoxp-a\n");
  const env = "A=1\nSLACK_USER_TOKENS=xoxp-a\nB=2\n";
  assert.equal(withToken(env, "xoxp-b"), "A=1\nSLACK_USER_TOKENS=xoxp-a xoxp-b\nB=2\n");
  assert.equal(withToken(env, "xoxp-a"), env);
});

test("replies go under an earlier message that isn't a reply", () => {
  const ok = parseScenario(
    scenario([
      { as: "Engineer", text: "a" },
      { as: "Engineer", text: "b", thread: 0 },
      { as: "Engineer", text: "c", thread: 0 },
    ]),
  );
  assert.ok(!("error" in ok));
  for (const text of [
    "not json",
    scenario([]),
    scenario([{ as: "Engineer", text: "a" }], "Has Spaces"),
    scenario([{ as: "Engineer", text: " " }]),
    scenario([{ as: "Engineer", text: "a", thread: 0 }]),
    scenario([
      { as: "Engineer", text: "a", thread: 1 },
      { as: "Engineer", text: "b" },
    ]),
    scenario([
      { as: "Engineer", text: "a" },
      { as: "Engineer", text: "b", thread: 0 },
      { as: "Engineer", text: "c", thread: 1 },
    ]),
  ])
    assert.ok("error" in parseScenario(text), text);
});

test("each name is one person's title, display name or full name, and mentions resolve", () => {
  const parsed = parseScenario(
    scenario([{ as: "product MANAGER", text: "{@Engineer} can you look at OA-12?" }]),
  ) as Scenario;
  const roles = cast(people, parsed);
  assert.ok(!("error" in roles));
  assert.equal(roles.get("product manager")?.user, "U1");
  assert.equal(roles.get("avery")?.user, "U1");
  assert.equal(resolve("{@jordan}", roles), "<@U2>");
  assert.equal(
    resolve("p95 < 2s & a -> b, {@jordan}", roles),
    "p95 &lt; 2s &amp; a -&gt; b, <@U2>",
  );
  assert.equal(resolve(parsed.messages[0]?.text ?? "", roles), "<@U2> can you look at OA-12?");

  const missing = cast(
    people,
    parseScenario(scenario([{ as: "Designer", text: "a" }])) as Scenario,
  );
  assert.ok("error" in missing && missing.error.includes("Designer"));
  const mentioned = cast(
    people,
    parseScenario(scenario([{ as: "Engineer", text: "{@Support lead} ?" }])) as Scenario,
  );
  assert.ok("error" in mentioned && mentioned.error.includes("Support lead"));
  const twice = cast(
    [...people, { token: "xoxp-x", user: "U3", names: ["engineer"] }],
    parseScenario(scenario([{ as: "Engineer", text: "a" }])) as Scenario,
  );
  assert.ok("error" in twice);
  // A name two people share is fine while the scenario doesn't use it.
  const unused = cast(
    [...people, { token: "xoxp-x", user: "U3", names: ["engineer", "Casey"] }],
    parseScenario(scenario([{ as: "Casey", text: "{@Avery}" }])) as Scenario,
  );
  assert.ok(!("error" in unused) && unused.get("casey")?.user === "U3");
  assert.ok(!("error" in unused) && !unused.has("engineer"));
  const ampersand = cast(
    [...people, { token: "xoxp-rd", user: "U4", names: ["R&D lead"] }],
    parseScenario(scenario([{ as: "Avery", text: "{@R&D lead} <3" }])) as Scenario,
  );
  assert.ok(!("error" in ampersand));
  assert.equal(resolve("{@R&D lead} <3", ampersand), "<@U4> &lt;3");
  // The same person authorizing twice is one person.
  const again = cast(
    [...people, { token: "xoxp-eng2", user: "U2", names: ["Engineer"] }],
    parseScenario(scenario([{ as: "Engineer", text: "a" }])) as Scenario,
  );
  assert.ok(!("error" in again) && again.get("engineer")?.token === "xoxp-eng2");
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

test("each message is posted by its role's person, replies under their message", async () => {
  const { run, sent } = fakeSlack();
  const log: string[] = [];
  await seed(run, ["xoxp-pm", "xoxp-eng"], conversation, (l) => log.push(l), 0);
  const posts = sent.filter((s) => s.method === "chat.postMessage");
  assert.deepEqual(
    posts.map((p) => [p.token, p.params.channel, p.params.text, p.params.thread_ts]),
    [
      ["xoxp-pm", "CNEW", "Standup: <@U2>?", undefined],
      ["xoxp-eng", "CNEW", "On it", "1.0"],
      ["xoxp-pm", "CNEW", "Thanks", undefined],
    ],
  );
  assert.deepEqual(
    sent.filter((s) => s.method === "conversations.join").map((s) => s.token),
    ["xoxp-pm", "xoxp-eng"],
  );
  assert.ok(log.includes("created #team"));
});

test("it posts nothing unless every token is the test workspace's and the channel is empty", async () => {
  const cases = [
    { options: { team: "TOTHER" }, error: /workspace TOTHER/ },
    { options: { channels: ["team"], history: [{}] }, error: /already has messages/ },
  ];
  for (const { options, error } of cases) {
    const { run, sent } = fakeSlack(options);
    await assert.rejects(
      seed(run, ["xoxp-pm", "xoxp-eng"], conversation, () => {}, 0),
      error,
    );
    assert.ok(!sent.some((s) => s.method === "chat.postMessage"));
    // Nobody but the first poster joins a channel it refuses.
    assert.ok(
      sent.filter((s) => s.method === "conversations.join").every((s) => s.token === "xoxp-pm"),
    );
  }
  const { run, sent } = fakeSlack();
  await assert.rejects(
    seed(run, ["xoxp-pm"], conversation, () => {}, 0),
    /Engineer/,
  );
  assert.ok(!sent.some((s) => s.method === "conversations.create"));
});

test("an existing channel is used, not created", async () => {
  const { run, sent } = fakeSlack({ channels: ["general", "team"] });
  await seed(run, ["xoxp-pm", "xoxp-eng"], conversation, () => {}, 0);
  assert.ok(!sent.some((s) => s.method === "conversations.create"));
  assert.ok(
    sent.filter((s) => s.method === "chat.postMessage").every((s) => s.params.channel === "C1"),
  );
});

test("a code becomes a token only for the test workspace, and needs the app's secret", async () => {
  const env = { clientId: "123.456", clientSecret: "s3cr3t", tokens: [] };
  const { run, sent } = fakeSlack();
  const { token, person } = await authorize(run, env, "abc");
  assert.equal(token, "xoxp-eng");
  assert.deepEqual(person.names, ["Engineer", "Jordan"]);
  assert.deepEqual(sent[0], {
    method: "oauth.v2.access",
    token: null,
    params: { client_id: "123.456", client_secret: "s3cr3t", code: "abc", redirect_uri: redirect },
  });
  await assert.rejects(authorize(fakeSlack({ team: "TOTHER" }).run, env, "abc"), /TOTHER/);
  await assert.rejects(authorize(run, { ...env, clientSecret: null }, "abc"), /SECRET/);
});
