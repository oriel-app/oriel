import { createHash, randomBytes } from "node:crypto";

export type Random = (bytes: number) => Uint8Array;

export type Pkce = { verifier: string; challenge: string };

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// 32 bytes give the 43-character verifier RFC 7636 recommends.
export function pkce(random: Random = randomBytes): Pkce {
  const verifier = base64url(random(32));
  return { verifier, challenge: challengeOf(verifier) };
}

export const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

export const newState = (random: Random = randomBytes) => base64url(random(32));
