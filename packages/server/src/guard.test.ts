import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "./guard.ts";

const port = 4310;

test("a same-origin read is allowed, by IP or by name", () => {
  assert.equal(refusal("GET", { host: "127.0.0.1:4310" }, port), null);
  assert.equal(refusal("GET", { host: "localhost:4310" }, port), null);
  assert.equal(
    refusal("GET", { host: "localhost:4310", origin: "http://localhost:4310" }, port),
    null,
  );
});

test("a Host that isn't this server is refused, which stops DNS rebinding", () => {
  assert.notEqual(refusal("GET", { host: "attacker.example:4310" }, port), null);
  assert.notEqual(refusal("GET", { host: "127.0.0.1:9999" }, port), null);
  assert.notEqual(refusal("GET", { host: "127.0.0.1" }, port), null);
  assert.notEqual(refusal("GET", {}, port), null);
});

test("another Origin is refused, whatever the method", () => {
  for (const method of ["GET", "HEAD", "POST", "DELETE"]) {
    assert.notEqual(
      refusal(method, { host: "127.0.0.1:4310", origin: "https://attacker.example" }, port),
      null,
      method,
    );
  }
  assert.notEqual(refusal("GET", { host: "127.0.0.1:4310", origin: "null" }, port), null);
  assert.notEqual(
    refusal("POST", { host: "127.0.0.1:4310", origin: "https://127.0.0.1:4310" }, port),
    null,
  );
});

test("a request that changes state needs this server's Origin", () => {
  assert.notEqual(refusal("POST", { host: "127.0.0.1:4310" }, port), null);
  assert.notEqual(refusal("PUT", { host: "127.0.0.1:4310" }, port), null);
  assert.equal(
    refusal("POST", { host: "127.0.0.1:4310", origin: "http://127.0.0.1:4310" }, port),
    null,
  );
});

test("on port 80 the browser's portless Host and Origin are accepted", () => {
  assert.equal(refusal("GET", { host: "127.0.0.1" }, 80), null);
  assert.equal(refusal("POST", { host: "localhost", origin: "http://localhost" }, 80), null);
  assert.notEqual(refusal("GET", { host: "127.0.0.1" }, 4310), null);
});
