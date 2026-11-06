// Google's OAuth for installed apps: PKCE, a checked `state` and a loopback
// redirect (RFC 8252), then the code's exchange, and refreshing. The client is
// the person's own, from this server's environment. No problem here quotes a
// code, a token, the client's ID or its secret.
// https://developers.google.com/identity/protocols/oauth2/native-app
import { type After, after, loopback } from "./loopback.ts";
import { newState, pkce, type Random } from "./pkce.ts";

export const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
export const tokenEndpoint = "https://oauth2.googleapis.com/token";
// Reading and writing every spreadsheet the account can, and listing them by
// name; nothing of Drive's but its files' names and dates.
export const scopes = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;

// GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET if it has one. Google treats a
// desktop client's secret as no secret, and PKCE does its work, so a client
// with no secret leaves `client_secret` out of its requests.
export type GoogleClient = { id: string; secret: string | null };

export function googleClientOf(env: Readonly<Record<string, string | undefined>>) {
  const id = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  return id ? { id, secret: secret || null } : null;
}

const clientForm = (client: GoogleClient): Record<string, string> => ({
  client_id: client.id,
  ...(client.secret === null ? {} : { client_secret: client.secret }),
});

// `expiresAt` is in milliseconds since the epoch.
export type Tokens = { access: string; refresh: string; expiresAt: number };

export type Fetch = typeof fetch;

export type SignInIo = {
  fetch: Fetch;
  // Opens the address in the person's browser.
  open: (url: string) => Promise<void>;
  // Milliseconds since the epoch.
  now: () => number;
  random?: Random;
  after?: After;
};

export type SignIn =
  | { status: "signed-in"; tokens: Tokens }
  | { status: "failed"; problem: string };

export type Refresh =
  | { status: "refreshed"; tokens: Tokens }
  // Google refused the refresh token: expired, revoked, or another client's.
  | { status: "signed-out" }
  | { status: "failed"; problem: string };

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
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    // A refresh token comes only with consent given again.
    prompt: "consent",
  }))
    url.searchParams.set(name, value);
  return url.toString();
}

const short = (scope: string) => scope.replace("https://www.googleapis.com/auth/", "");

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
  const exchanged = await token(
    {
      grant_type: "authorization_code",
      code: redirect.query.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: listener.redirectUri,
      ...clientForm(client),
    },
    io,
  );
  if (exchanged.status !== "ok") return { status: "failed", problem: exchanged.problem };
  const { body } = exchanged;
  if (body.refresh_token === undefined)
    return { status: "failed", problem: "Google sent no refresh token" };
  // Google's consent page lets the person untick a scope.
  const granted = (body.scope ?? "").split(" ");
  const missing = scopes.filter((scope) => !granted.includes(scope));
  if (missing.length)
    return {
      status: "failed",
      problem: `Google didn't grant ${missing.map(short).join(" or ")}; sign in again and leave both ticked`,
    };
  return {
    status: "signed-in",
    tokens: {
      access: body.access_token,
      refresh: body.refresh_token,
      expiresAt: io.now() + body.expires_in * 1000,
    },
  };
}

export async function refresh(
  client: GoogleClient,
  refreshToken: string,
  io: Pick<SignInIo, "fetch" | "now">,
): Promise<Refresh> {
  const refreshed = await token(
    { grant_type: "refresh_token", refresh_token: refreshToken, ...clientForm(client) },
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
      // Google may send a new one; the newest is kept.
      refresh: body.refresh_token ?? refreshToken,
      expiresAt: io.now() + body.expires_in * 1000,
    },
  };
}

type Granted = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

function grantedOf(json: unknown): Granted | null {
  if (typeof json !== "object" || json === null) return null;
  const { access_token, expires_in, refresh_token, scope } = json as Record<string, unknown>;
  if (typeof access_token !== "string" || access_token === "") return null;
  if (typeof expires_in !== "number" || !(expires_in > 0)) return null;
  if (refresh_token !== undefined && typeof refresh_token !== "string") return null;
  if (scope !== undefined && typeof scope !== "string") return null;
  return json as Granted;
}

type Answer =
  | { status: "ok"; body: Granted }
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
    // Error codes are Google's fixed words; its description isn't quoted.
    const said = (json as { error?: unknown } | null)?.error;
    const error = typeof said === "string" && /^[a-z_]{1,64}$/.test(said) ? said : "";
    const secret = error === "invalid_client" || error === "unauthorized_client";
    return {
      status: "refused",
      error,
      problem: secret
        ? `Google refused this client (${response.status} ${error}): check GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET if the client has one`
        : `Google refused the token request (${response.status}${error ? ` ${error}` : ""})`,
    };
  }
  const body = grantedOf(json);
  if (!body) return { status: "failed", problem: "Google's token answer isn't one this reads" };
  return { status: "ok", body };
}
