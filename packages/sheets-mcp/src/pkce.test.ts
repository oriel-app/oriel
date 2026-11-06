import assert from "node:assert/strict";
import { test } from "node:test";
import { challengeOf, newState, pkce } from "./pkce.ts";

// RFC 7636, Appendix B.
const rfcBytes = Uint8Array.from([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105,
  214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);

test("the verifier and S256 challenge are RFC 7636's test vector", () => {
  const random = (bytes: number) => {
    assert.equal(bytes, 32);
    return rfcBytes;
  };
  assert.deepEqual(pkce(random), {
    verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  });
  assert.equal(
    challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("each verifier and state is new, and only unreserved characters", () => {
  const a = pkce();
  const b = pkce();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(newState(), newState());
  for (const value of [a.verifier, a.challenge, newState()])
    assert.match(value, /^[A-Za-z0-9_-]{43}$/);
});
