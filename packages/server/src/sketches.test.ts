// Sketches on the server (decision 0033): stored with their turn, framed
// from the sketch origin, which serves only `GET /sketches/<thread>/<sketch>`
// behind the Host check, checked again each time, under a policy that stops
// every fetch, in a frame with no sandbox token. The window's pages may
// frame that origin; a review link's page may not.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Sketch, type Ulid } from "@oriel/core";
import { assets } from "@oriel/web/files";
import { defaultTheme } from "@oriel/web/themes";
import type { ThreadView } from "@oriel/web/view";
import { agentEvent } from "./agent.ts";
import { sketchDocument, sketchHandler, sketchStyle } from "./sketch-site.ts";
import { json, port, type Script, sketchOrigin, sketchPort, testApp } from "./testing.ts";

const css = readFileSync(fileURLToPath(new URL("window.css", `${assets.href}/`)), "utf8");
const sheet = sketchStyle(css, defaultTheme, "default");

const drawing = `<style>p { color: var(--text-muted); }</style><p title="a &amp; &quot;b&quot;">Ships "soon" & then</p>`;

const draw =
  (html: string, height = 400): Script =>
  async (bindings) => ({ value: (await bindings.read("sketch", [html, height])).value });

// A thread whose one turn ran `scripts`' draw, and the sketch origin over
// the app.
async function sketched(t: Parameters<typeof testApp>[0], script = draw(drawing)) {
  const app = await testApp(t, {
    scripts: { draw: script },
    plan: () => [{ run: "draw" }, { text: "Drawn." }],
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "cluster", grouping: "epic", cluster: "10001" }),
  );
  const { id } = json<{ id: Ulid }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Draw it" }),
  );
  await app.app.settled();
  const serve = sketchHandler({
    port: sketchPort,
    framedBy: port,
    sketch: app.app.sketch,
    sheet: () => sheet,
  });
  const get = (url: string, host = `127.0.0.1:${sketchPort}`, method = "GET") =>
    serve({ method, url, headers: { host } });
  return { app, id, get, serve };
}

const body = (reply: { body: string | Uint8Array }) =>
  typeof reply.body === "string" ? reply.body : new TextDecoder().decode(reply.body);

test("a sketch is stored with its turn, framed from the sketch origin under the reply, and counted", async (t) => {
  const { app, id } = await sketched(t);
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.deepEqual(
    view.entries.map((e) => e.kind),
    ["user", "run.started", "run.finished", "text", "sketch", "done"],
  );
  const entry = view.entries.find((e) => e.kind === "sketch");
  assert.ok(entry?.kind === "sketch");
  const [, sketchId] = /\/sketches\/[0-9A-Z]{26}\/([0-9A-Z]{26})$/.exec(entry.sketch.src) ?? [];
  assert.equal(entry.sketch.src, `${sketchOrigin}/sketches/${id}/${sketchId}`);
  assert.equal(entry.sketch.height, 400);
  const stored = app.app.sketch(id, sketchId as Ulid);
  assert.deepEqual(stored, { id: sketchId, html: drawing, height: 400 });
  const counted = app.app.telemetry().filter((e) => e.name.startsWith("sketch."));
  assert.deepEqual(
    counted.map((e) => [e.name, e.data]),
    [["sketch.shown", { threadId: id, height: 400, bytes: Buffer.byteLength(drawing) }]],
  );
});

test("a refused sketch is counted by why, never with its text, and nothing is stored or shown", async (t) => {
  const { app, id } = await sketched(t, draw('<iframe src="http://x.test/"></iframe>'));
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(
    view.entries.some((e) => e.kind === "sketch"),
    false,
  );
  const counted = app.app.telemetry().filter((e) => e.name.startsWith("sketch."));
  assert.deepEqual(
    counted.map((e) => [e.name, e.data]),
    [["sketch.refused", { threadId: id, reason: "not-allowed" }]],
  );
});

const sketchOf = async (app: Awaited<ReturnType<typeof testApp>>, id: Ulid): Promise<Sketch> => {
  const view = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const entry = view.entries.find((e) => e.kind === "sketch");
  const sketchId = entry?.kind === "sketch" ? entry.sketch.src.split("/").at(-1) : undefined;
  const sketch = sketchId ? app.app.sketch(id, sketchId as Ulid) : null;
  assert.ok(sketch);
  return sketch;
};

test("the sketch origin serves Oriel's document: one frame with no token, the sheet first, the text escaped", async (t) => {
  const { app, id, get } = await sketched(t);
  const sketch = await sketchOf(app, id);
  const reply = await get(`/sketches/${id}/${sketch.id}`);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.headers, {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors http://127.0.0.1:${port} http://localhost:${port}; sandbox`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-type": "text/html; charset=utf-8",
  });
  const html = body(reply);
  assert.equal(html, sketchDocument(sheet, drawing));
  // One frame, no token, and no script anywhere.
  assert.equal(html.match(/<iframe/g)?.length, 1);
  assert.match(html, /<iframe sandbox title="A sketch by the agent" srcdoc="/);
  assert.doesNotMatch(html, /allow-|<script/);
  // The agent's " and & can't leave srcdoc: the attribute holds its text as
  // written, and nothing after it is markup of the outer document.
  const srcdoc = /srcdoc="([^"]*)"><\/iframe>\n$/.exec(html)?.[1] ?? "";
  const inner = srcdoc.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  assert.equal(inner, `<!doctype html><html lang="en"><style>${sheet}</style>${drawing}`);
  // The sheet holds the person's theme's neutral tokens, and none that
  // could draw Approve.
  assert.match(inner, /--bg: #[0-9a-f]+;/);
  assert.doesNotMatch(inner, /--accent|--danger|--on-accent|--done\b/);
});

test("the sketch origin answers only its own Host, GET and HEAD, and its one route by ULIDs", async (t) => {
  const { app, id, get, serve } = await sketched(t);
  const sketch = await sketchOf(app, id);
  const path = `/sketches/${id}/${sketch.id}`;
  assert.equal((await get(path, `localhost:${sketchPort}`)).status, 200);
  assert.equal((await get(path, `127.0.0.1:${sketchPort}`, "HEAD")).status, 200);
  for (const host of [`127.0.0.1:${port}`, "attacker.test", `attacker.test:${sketchPort}`]) {
    const refused = await get(path, host);
    assert.equal(refused.status, 403, host);
    assert.match(refused.headers["content-security-policy"] ?? "", /^default-src 'none'/);
  }
  // A POST is refused by the guard, with no Origin, or as no route, with one.
  assert.equal((await get(path, `127.0.0.1:${sketchPort}`, "POST")).status, 403);
  const own = { host: `127.0.0.1:${sketchPort}`, origin: `http://127.0.0.1:${sketchPort}` };
  assert.equal((await serve({ method: "POST", url: path, headers: own })).status, 405);
  for (const wrong of [
    `/sketches/${id}/${sketch.id}/`,
    `/sketches/${id}/01J00000000000000000000000`,
    `/sketches/nope/${sketch.id}`,
    `/sketches/${sketch.id}/${id}`,
    "/",
    "/api/browse?grouping=epic",
  ])
    assert.equal((await get(wrong)).status, 404, wrong);
});

test("a stored sketch meets today's check each time it's served, and a deleted thread's is gone", async (t) => {
  const { app, id, get } = await sketched(t);
  const sketch = await sketchOf(app, id);
  // As one stored before an element left the list would be.
  const tampered = "01J00000000000000000000009" as Ulid;
  const event = {
    kind: "sketch",
    runId: "01J00000000000000000000008",
    sketch: {
      id: tampered,
      html: '<p>x</p><iframe src="http://x.test/"></iframe>',
      height: 240 as const,
    },
  };
  // The store keeps what Oriel checked then; the route checks it again.
  assert.ok(agentEvent(event).ok);
  const refused = await sketchHandler({
    port: sketchPort,
    framedBy: port,
    sketch: (thread, sketchId) =>
      thread === id && sketchId === tampered ? event.sketch : app.app.sketch(thread, sketchId),
    sheet: () => sheet,
  })({
    method: "GET",
    url: `/sketches/${id}/${tampered}`,
    headers: { host: `127.0.0.1:${sketchPort}` },
  });
  assert.equal(refused.status, 410);
  assert.doesNotMatch(body(refused), /iframe/);

  await app.post(`/api/threads/${id}/delete`, { via: "page" });
  assert.equal(app.app.sketch(id, sketch.id), null);
  assert.equal((await get(`/sketches/${id}/${sketch.id}`)).status, 404);
});

test("in the desktop app, the sketch origin wants the launch secret, as the window does", async (t) => {
  const { app, id } = await sketched(t);
  const sketch = await sketchOf(app, id);
  const serve = sketchHandler({
    port: sketchPort,
    framedBy: port,
    sketch: app.app.sketch,
    sheet: () => sheet,
    launch: { cookie: "oriel-launch", secret: "s3cret" },
  });
  const get = (cookie?: string) =>
    serve({
      method: "GET",
      url: `/sketches/${id}/${sketch.id}`,
      headers: { host: `127.0.0.1:${sketchPort}`, ...(cookie ? { cookie } : {}) },
    });
  assert.equal((await get()).status, 403);
  assert.equal((await get("oriel-launch=wrong")).status, 403);
  assert.equal((await get("other=1; oriel-launch=s3cret")).status, 200);
});
