// Google's OAuth for installed apps, run by the server with no hosted helper
// (decision 0050): PKCE, a checked `state`, a loopback redirect, and Google's
// Picker in the same tab, with the one scope `drive.file`. Then the code's
// exchange, and refreshing. No problem here quotes a code, a token or the
// client's secret.
import { type Infer, number, object, optional, string } from "@oriel/core";
import { type After, after, loopback } from "./loopback.ts";
import { newState, pkce, type Random } from "./pkce.ts";

export const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
export const tokenEndpoint = "https://oauth2.googleapis.com/token";
export const scope = "https://www.googleapis.com/auth/drive.file";
export const spreadsheetType = "application/vnd.google-apps.spreadsheet";

// Oriel's desktop client: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, never in
// the repo.
export type GoogleClient = { id: string; secret: string };

// The connection's secret (decision 0049), kept in memory until connections
// keep it. `expiresAt` is in milliseconds since the epoch.
export type Tokens = { access: string; refresh: string; expiresAt: number };

export type Fetch = typeof fetch;

export type SignInIo = {
  fetch: Fetch;
  // Opens the address in the person's default browser.
  open: (url: string) => Promise<void>;
  // Milliseconds since the epoch, read when tokens arrive.
  now: () => number;
  random?: Random;
  after?: After;
};

export type SignIn =
  | { status: "signed-in"; tokens: Tokens; picked: string[] }
  | { status: "failed"; problem: string };

export type Refresh =
  | { status: "refreshed"; tokens: Tokens }
  // Google refused the refresh token: the connection is signed out, and
  // signing in again keeps it.
  | { status: "signed-out" }
  | { status: "failed"; problem: string };

// Signing in and picking spreadsheets are one request: `trigger_onepick`
// opens Google's Picker after consent, in the same tab.
export function authorizeUrl(
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const url = new URL(authorizeEndpoint);
  for (const [name, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "consent",
    trigger_onepick: "true",
    allow_multiple: "true",
    mimetypes: spreadsheetType,
  }))
    url.searchParams.set(name, value);
  return url.toString();
}

// A Drive file ID: letters, digits, `-` and `_`.
const fileId = /^[A-Za-z0-9_-]{1,200}$/;

// The picked spreadsheets' IDs, in one comma-separated parameter or several.
export function pickedFiles(query: URLSearchParams): string[] | null {
  const ids = query
    .getAll("picked_file_ids")
    .flatMap((value) => value.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.every((id) => fileId.test(id))) return null;
  return [...new Set(ids)];
}

export async function signIn(client: GoogleClient, io: SignInIo): Promise<SignIn> {
  const { verifier, challenge } = pkce(io.random);
  const state = newState(io.random);
  const listener = await loopback(state, io.after ?? after);
  try {
    await io.open(authorizeUrl(client.id, listener.redirectUri, challenge, state));
  } catch {
    listener.close();
    return { status: "failed", problem: "the browser didn't open" };
  }
  const redirect = await listener.redirect;
  if (redirect.status === "timed-out")
    return { status: "failed", problem: "nobody finished signing in within 5 minutes" };
  if (redirect.status === "refused") return { status: "failed", problem: redirect.problem };
  const picked = pickedFiles(redirect.query);
  if (picked === null)
    return { status: "failed", problem: "Google sent a file ID Oriel can't read" };
  const exchanged = await token(
    {
      grant_type: "authorization_code",
      code: redirect.query.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: listener.redirectUri,
      client_id: client.id,
      client_secret: client.secret,
    },
    io,
  );
  if (exchanged.status !== "ok") return { status: "failed", problem: exchanged.problem };
  const { body } = exchanged;
  if (body.refresh_token === undefined)
    return { status: "failed", problem: "Google sent no refresh token" };
  if (!(body.scope ?? "").split(" ").includes(scope))
    return { status: "failed", problem: "Google didn't grant access to the picked files" };
  return {
    status: "signed-in",
    tokens: {
      access: body.access_token,
      refresh: body.refresh_token,
      expiresAt: io.now() + body.expires_in * 1000,
    },
    picked,
  };
}

export async function refresh(
  client: GoogleClient,
  refreshToken: string,
  io: Pick<SignInIo, "fetch" | "now">,
): Promise<Refresh> {
  const refreshed = await token(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.id,
      client_secret: client.secret,
    },
    io,
  );
  if (refreshed.status === "refused" && refreshed.error === "invalid_grant")
    return { status: "signed-out" };
  if (refreshed.status !== "ok") return { status: "failed", problem: refreshed.problem };
  const { body } = refreshed;
  return {
    status: "refreshed",
    tokens: {
      access: body.access_token,
      // Google may send a new one; the newest is kept (decision 0050).
      refresh: body.refresh_token ?? refreshToken,
      expiresAt: io.now() + body.expires_in * 1000,
    },
  };
}

const granted = object({
  access_token: string,
  expires_in: number,
  refresh_token: optional(string),
  scope: optional(string),
});

const refusal = object({ error: string });

type Answer =
  | { status: "ok"; body: Infer<typeof granted> }
  | { status: "refused"; error: string; problem: string }
  | { status: "failed"; problem: string };

const requestMs = 30_000;

async function token(form: Record<string, string>, io: { fetch: Fetch }): Promise<Answer> {
  let response: Response;
  let json: unknown;
  try {
    response = await io.fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(requestMs),
    });
    json = await response.json();
  } catch {
    return { status: "failed", problem: "Google's token endpoint didn't answer" };
  }
  if (!response.ok) {
    const refused = refusal(json);
    const error =
      refused.ok && /^[a-z_]{1,64}$/.test(refused.value.error) ? refused.value.error : "";
    return {
      status: "refused",
      error,
      problem: `Google refused the token request (${response.status}${error ? ` ${error}` : ""})`,
    };
  }
  const body = granted(json);
  if (!body.ok) return { status: "failed", problem: "Google's token answer isn't one Oriel reads" };
  return { status: "ok", body: body.value };
}
