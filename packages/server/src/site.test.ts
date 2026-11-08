import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { handler, type Look, type Request } from "./site.ts";

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

test("the page runs only its own scripts and the import map's hash, and nothing frames it", async (t) => {
  const reply = await site(t)(get("/"));
  assert.equal(reply.status, 200);
  const map = /<script type="importmap">(.*)<\/script>/.exec(text(reply.body))?.[1] ?? "";
  const hash = createHash("sha256").update(map).digest("base64");
  const csp = reply.headers["content-security-policy"] ?? "";
  const scripts = /script-src ([^;]*)/.exec(csp)?.[1];
  assert.equal(scripts, `'self' 'sha256-${hash}'`);
  assert.match(csp, /frame-ancestors 'none'/);
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

test("other hosts and origins are refused before any route runs", async (t) => {
  const handle = site(t);
  assert.equal((await handle(get("/", { host: "attacker.example:4310" }))).status, 403);
  const reply = await handle(
    get("/api/browse?grouping=epic", { host, origin: "https://attacker.example" }),
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

test("the window's pages may frame the sketch origin, and a review link's page frames nothing", async (t) => {
  const handle = site(t, undefined, "http://127.0.0.1:4311");
  for (const path of ["/", "/threads/01J00000000000000000000000", "/api/browse?grouping=epic"]) {
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
