import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { WindowView } from "@oriel/web/view";
import { handler, type Look, type Request, within } from "./site.ts";

const port = 4310;
const host = "127.0.0.1:4310";

// A site in its own temp dir, with a file beside its roots that must stay unserved.
function site(t: TestContext, look?: Look, sketches?: string) {
  const root = mkdtempSync(join(tmpdir(), "oriel-site-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["dist", "assets", "vendor"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, "dist", "main.js"), "export {};\n");
  writeFileSync(join(root, "assets", "window.css"), "body {}\n");
  writeFileSync(join(root, "vendor", "preact.mjs"), "export const h = 1;\n");
  writeFileSync(join(root, "secret.js"), "secret\n");
  return handler({
    port,
    dist: join(root, "dist"),
    entry: "main.js",
    assets: join(root, "assets"),
    vendor: new Map([["preact", join(root, "vendor", "preact.mjs")]]),
    window: (grouping): WindowView => ({
      grouping,
      clusters: [],
      items: 0,
      asOf: "2026-10-29T09:00:00.000Z",
      fixture: true,
    }),
    ...(look ? { look: () => look } : {}),
    ...(sketches ? { sketches } : {}),
  });
}

function get(url: string, headers: Request["headers"] = { host }): Request {
  return { method: "GET", url, headers };
}

function text(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

test("the page names the vendor files in an import map its CSP allows", async (t) => {
  const reply = await site(t)(get("/"));
  assert.equal(reply.status, 200);
  const page = text(reply.body);
  const map = /<script type="importmap">(.*)<\/script>/.exec(page)?.[1] ?? "";
  assert.deepEqual(JSON.parse(map), { imports: { preact: "/vendor/preact.js" } });
  const hash = createHash("sha256").update(map).digest("base64");
  const csp = reply.headers["content-security-policy"] ?? "";
  assert.match(csp, new RegExp(`script-src 'self' 'sha256-${hash.replaceAll("+", "\\+")}'`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(page, /<script type="module" src="\/app\/main.js"><\/script>/);
});

test("compiled modules, assets and vendor files are served with their types", async (t) => {
  const handle = site(t);
  const cases = [
    ["/app/main.js", "text/javascript; charset=utf-8", "export {};\n"],
    ["/assets/window.css", "text/css; charset=utf-8", "body {}\n"],
    ["/vendor/preact.js", "text/javascript; charset=utf-8", "export const h = 1;\n"],
  ];
  for (const [url = "", type, body] of cases) {
    const reply = await handle(get(url));
    assert.equal(reply.status, 200, url);
    assert.equal(reply.headers["content-type"], type, url);
    assert.equal(reply.headers["x-content-type-options"], "nosniff", url);
    assert.equal(text(reply.body), body, url);
  }
});

test("nothing outside the served roots is reachable", async (t) => {
  const handle = site(t);
  for (const url of [
    "/app/../secret.js",
    "/app/..%2fsecret.js",
    "/app/%2e%2e/secret.js",
    "/assets/..%2f..%2fsecret.js",
    "/app/%00.js",
    "/app/%E0%A4%A.js",
    "/vendor/preact/hooks.js",
    "/secret.js",
    "/app/missing.js",
    "/app/",
  ]) {
    assert.equal((await handle(get(url))).status, 404, url);
  }
});

test("within keeps paths inside their root", () => {
  assert.equal(within("/srv/dist", "a/b.js"), "/srv/dist/a/b.js");
  assert.equal(within("/srv/dist/", "a.js"), "/srv/dist/a.js");
  assert.equal(within("/srv/dist", "../secret.js"), null);
  assert.equal(within("/srv/dist", "..%2fsecret.js"), null);
  assert.equal(within("/srv/dist", "/etc/passwd"), null);
  assert.equal(within("/srv/dist", ""), null);
});

test("the window API returns view data for a known grouping only", async (t) => {
  const handle = site(t);
  const reply = await handle(get("/api/window?grouping=stuck"));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["content-type"], "application/json");
  assert.equal(JSON.parse(text(reply.body)).grouping, "stuck");
  for (const url of ["/api/window", "/api/window?grouping=toString", "/api/window?grouping="]) {
    assert.equal((await handle(get(url))).status, 400, url);
  }
});

test("other hosts and origins are refused before any route runs", async (t) => {
  const handle = site(t);
  assert.equal((await handle(get("/", { host: "attacker.example:4310" }))).status, 403);
  const reply = await handle(
    get("/api/window?grouping=epic", { host, origin: "https://attacker.example" }),
  );
  assert.equal(reply.status, 403);
});

test("state-changing methods need this server's Origin, and no route takes them yet", async (t) => {
  const handle = site(t);
  const post = (headers: Request["headers"]) => handle({ method: "POST", url: "/", headers });
  assert.equal((await post({ host })).status, 403);
  assert.equal((await post({ host, origin: "https://attacker.example" })).status, 403);
  const own = await post({ host, origin: `http://${host}` });
  assert.equal(own.status, 405);
  assert.equal(own.headers.allow, "GET, HEAD");
});

test("the Done page is served at /done with its page number, and nothing is at /inbox", async (t) => {
  const handle = site(t);
  assert.equal((await handle(get("/inbox"))).status, 404);
  for (const url of ["/done", "/done?page=2"]) {
    const reply = await handle(get(url));
    assert.equal(reply.status, 200, url);
    assert.match(text(reply.body), /<script type="module" src="\/app\/main.js"><\/script>/, url);
  }
});

test("the page's <html> carries the person's theme and text size, but a review link's doesn't", async (t) => {
  const handle = site(t, { theme: "broadsheet", textSize: "large" });
  for (const path of ["/", "/settings", "/settings/appearance", "/done"]) {
    const page = text((await handle(get(path))).body);
    assert.match(page, /<html lang="en" data-theme="broadsheet" data-text-size="large">/, path);
  }
  const review = text((await handle(get("/review/abc_DEF-123"))).body);
  assert.match(review, /<html lang="en">/);
  const plain = text((await site(t, { theme: "graphite", textSize: "default" })(get("/"))).body);
  assert.match(plain, /<html lang="en">/);
  assert.equal((await handle(get("/settings/nothing"))).status, 404);
});

test("the window's pages may frame the sketch origin, and a review link's page frames nothing", async (t) => {
  const handle = site(t, undefined, "http://127.0.0.1:4311");
  for (const path of ["/", "/threads/01J00000000000000000000000", "/api/window?grouping=epic"]) {
    const csp = (await handle(get(path))).headers["content-security-policy"] ?? "";
    assert.match(csp, /; frame-src http:\/\/127\.0\.0\.1:4311;/, path);
  }
  const review = await handle(get("/review/abc"));
  assert.equal(review.status, 200);
  const csp = review.headers["content-security-policy"] ?? "";
  assert.doesNotMatch(csp, /frame-src/);
  assert.match(csp, /^default-src 'none';/);
  assert.equal(review.headers["x-robots-tag"], "noindex");
  // Without a sketch origin, no page may frame anything.
  const plain = (await site(t)(get("/"))).headers["content-security-policy"] ?? "";
  assert.doesNotMatch(plain, /frame-src/);
});
