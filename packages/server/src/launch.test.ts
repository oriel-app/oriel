// Every request needs the launch cookie, except what a review link's page needs, where the review token is the credential.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ReviewView, ThreadView } from "@oriel/web/view";
import { hasLaunchSecret } from "./guard.ts";
import { handler, type Request } from "./site.ts";
import { estimate, host, json, origin, port, testApp } from "./testing.ts";

const secret = "0f".repeat(32);
const cookie = `oriel-launch=${secret}`;
const launch = { cookie: "oriel-launch", secret };

test("the launch cookie matches only the secret, by name, among other cookies", () => {
  assert.ok(hasLaunchSecret(cookie, "oriel-launch", secret));
  assert.ok(hasLaunchSecret(`theme=dark; ${cookie}; other=1`, "oriel-launch", secret));
  assert.ok(hasLaunchSecret(`oriel-launch=planted; ${cookie}`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(undefined, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret("", "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(`oriel-launch=${"0e".repeat(32)}`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(`oriel-launch=${secret.slice(1)}`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(`oriel-launch=${secret}0`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(`other=${secret}`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(`xoriel-launch=${secret}`, "oriel-launch", secret));
  assert.ok(!hasLaunchSecret(secret, "oriel-launch", secret));
});

function files(t: { after(fn: () => void): void }) {
  const top = mkdtempSync(join(tmpdir(), "oriel-launch-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  for (const dir of ["dist", "assets", "vendor"]) mkdirSync(join(top, dir));
  writeFileSync(join(top, "dist", "main.js"), "export {};\n");
  writeFileSync(join(top, "assets", "window.css"), "body {}\n");
  writeFileSync(join(top, "vendor", "preact.js"), "export {};\n");
  return {
    dist: join(top, "dist"),
    entry: "main.js",
    assets: join(top, "assets"),
    vendor: new Map([["preact", join(top, "vendor", "preact.js")]]),
  };
}

const get = (path: string, headers: Request["headers"] = {}): Request => ({
  method: "GET",
  url: path,
  headers: { host, ...headers },
});

test("with a launch secret, every page and route needs its cookie, GET included", async (t) => {
  const app = await testApp(t);
  const handle = handler({
    ...files(t),
    port,

    api: app.app.api,
    launch,
  });
  const paths = [
    "/",
    "/browse",
    "/done",
    "/threads/new",
    "/api/threads",
    "/api/workstreams",
    "/api/browse?grouping=epic",
    "/api/threads/events",
    "/nowhere",
    "/review",
    "/review/",
    "/api/review/open",
  ];
  for (const path of paths) {
    const refused = await handle(get(path));
    assert.equal(refused.status, 403, path);
    assert.equal(refused.headers["referrer-policy"], "no-referrer");
    const planted = await handle(get(path, { cookie: "oriel-launch=planted" }));
    assert.equal(planted.status, 403, path);
  }
  for (const path of ["/", "/browse", "/api/workstreams", "/api/browse?grouping=epic"])
    assert.equal((await handle(get(path, { cookie }))).status, 200, path);
  // Host and Origin are checked as before, cookie or not.
  assert.equal((await handle(get("/", { cookie, host: "attacker.example:4310" }))).status, 403);
  assert.equal(
    (await handle(get("/", { cookie, origin: "https://attacker.example" }))).status,
    403,
  );
  const post = (url: string, headers: Request["headers"]) =>
    handle({
      method: "POST",
      url,
      headers: { host, origin, "content-type": "application/json", ...headers },
      body: async () => "{}",
    });
  assert.equal((await post("/api/workstreams", {})).status, 403);
  assert.equal((await post("/api/telemetry", {})).status, 403);
  assert.notEqual((await post("/api/workstreams", { cookie })).status, 403);
});

test("the web app's static files need no cookie, and nothing outside them comes with them", async (t) => {
  const app = await testApp(t);
  const handle = handler({ ...files(t), port, api: app.app.api, launch });
  for (const path of ["/app/main.js", "/assets/window.css", "/vendor/preact.js"]) {
    assert.equal((await handle(get(path))).status, 200, path);
    assert.equal((await handle({ ...get(path), method: "HEAD" })).status, 200, path);
  }
  assert.equal((await handle(get("/app/missing.js"))).status, 404);
  // Dot segments are resolved before the check, as before routing.
  for (const path of ["/assets/../api/threads", "/assets/%2e%2e/api/threads", "/app/../browse"])
    assert.equal((await handle(get(path))).status, 403, path);
  assert.equal(
    (
      await handle({
        method: "POST",
        url: "/assets/window.css",
        headers: { host, origin },
        body: async () => "",
      })
    ).status,
    403,
  );
});

test("a review link's page, opening and deciding need no cookie; making or revoking a link does", async (t) => {
  const app = await testApp(t, { scripts: { estimate }, plan: () => [{ run: "estimate" }] });
  const handle = handler({ ...files(t), port, api: app.app.api, launch });
  const post = (url: string, value: unknown, headers: Request["headers"] = {}) =>
    handle({
      method: "POST",
      url,
      headers: { host, origin, "content-type": "application/json", ...headers },
      body: app.body(JSON.stringify(value)),
    });
  const { id: workstreamId } = json<{ id: string }>(
    await post(
      "/api/workstreams",
      { kind: "cluster", grouping: "epic", cluster: "10001" },
      { cookie },
    ),
  );
  const { id: threadId } = json<{ id: string }>(
    await post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate" }, { cookie }),
  );
  await app.app.settled();
  const [set] = json<ThreadView>(
    await handle(get(`/api/threads/${threadId}`, { cookie })),
  ).changeSets;
  assert.ok(set);
  const link = `/api/change-sets/${set.id}/review-link`;
  assert.equal((await post(link, {})).status, 403);
  const minted = await post(link, {}, { cookie });
  assert.equal(minted.status, 200);
  const url = new URL(json<{ url: string }>(minted).url);
  const token = url.pathname.split("/").at(-1);

  const page = await handle(get(url.pathname));
  assert.equal(page.status, 200);
  assert.match(String(page.body), /<div id="app">/);
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["x-robots-tag"], "noindex");
  assert.deepEqual(await handle(get(url.pathname, { cookie })), page);
  const opened = await post("/api/review/open", { token });
  assert.equal(opened.status, 200);
  const review = json<ReviewView>(opened);
  assert.equal(review.changeSet.id, set.id);
  assert.equal((await post(`${link}/revoke`, {})).status, 403);
  assert.equal((await handle(get(`/api/threads/${threadId}`))).status, 403);
  const decided = await post("/api/review/decide", {
    token,
    changeSet: set.id,
    kind: "rejected",
    name: "Ana",
    hash: review.diff.hash,
  });
  assert.equal(decided.status, 200);
  assert.equal((await post("/api/review/dismiss", { token })).status, 400);
  // A dead token gets the API's own answer, not a pass.
  assert.equal((await post("/api/review/open", { token })).status, 404);
});
