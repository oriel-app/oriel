import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { handle } from "./server.ts";

// The status the workshop answers a GET with, called directly, without a
// socket.
function status(url: string, host = "127.0.0.1:4400", method = "GET"): number {
  let said = 0;
  const req = { url, method, headers: { host } } as unknown as IncomingMessage;
  const res = {
    writeHead(code: number) {
      said = code;
    },
    end() {},
  } as unknown as ServerResponse;
  handle(req, res);
  return said;
}

test("answers only a request addressed to this machine", () => {
  assert.equal(status("/assets/frame.css"), 200);
  assert.equal(status("/assets/frame.css", "localhost:4400"), 200);
  assert.equal(status("/assets/frame.css", "evil.example:4400"), 421);
  assert.equal(status("/assets/frame.css", "127.0.0.1.evil.example"), 421);
  assert.equal(status("/assets/frame.css", ""), 421);
});

test("serves its assets, and nothing above them", () => {
  assert.equal(status("/assets/../README.md"), 404);
  assert.equal(status("/assets/..%2FREADME.md"), 404);
  assert.equal(status("/shots/..%2F..%2F..%2FREADME.md"), 404);
  assert.equal(status("/shots/../../../package.json"), 404);
});

test("shows the checkout's files, but never one git ignores", () => {
  assert.equal(status("/source/packages/web/assets/window.css"), 200);
  assert.equal(status("/source/.env"), 404);
  assert.equal(status("/source/../../../../etc/hosts"), 404);
  assert.equal(status("/source/packages/web/assets/window.css?at=HEAD"), 404);
  assert.equal(status("/source/packages/web/assets/window.css?at=-p"), 404);
});

test("reads only", () => {
  assert.equal(status("/", "127.0.0.1:4400", "POST"), 405);
});

test("a malformed path is a 400, not a crash", () => {
  assert.equal(status("/%E0%A4%A"), 400);
});
