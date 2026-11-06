// PKCE (RFC 7636) with `S256`, and the `state` a sign-in checks on the way
// back. Random bytes are passed in, so tests can use the RFC's own vector.
import { createHash, randomBytes } from "node:crypto";

export type Random = (bytes: number) => Uint8Array;

export type Pkce = { verifier: string; challenge: string };

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// 32 bytes give the 43-character verifier the RFC recommends.
export function pkce(random: Random = randomBytes): Pkce {
  const verifier = base64url(random(32));
  return { verifier, challenge: challengeOf(verifier) };
}

export const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

// Unguessable, and new for each sign-in.
export const newState = (random: Random = randomBytes) => base64url(random(32));
