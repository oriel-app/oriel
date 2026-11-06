// Calls to Google's Drive and Sheets APIs, with an access token from the
// source given, and once more with a new one if Google refuses it. A call
// that fails throws a `Refusal`: a short sentence for the person or model
// that called the tool, which never quotes a token.
import type { AccessSource } from "./access.ts";
import type { Fetch } from "./oauth.ts";

export const driveOrigin = "https://www.googleapis.com";
export const sheetsOrigin = "https://sheets.googleapis.com";
export const spreadsheetType = "application/vnd.google-apps.spreadsheet";

export class Refusal extends Error {}

export type Google = { fetch: Fetch; source: AccessSource };

const requestMs = 30_000;

// Google's own message, on one line, whole: cutting it could leave part of
// a secret the server's redaction no longer knows. A 400's names what was wrong
// with what the caller sent, such as a range that doesn't parse.
function messageOf(json: unknown): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message.replace(/\s+/g, " ").trim() : "";
}

// Why Google refused, as its error body has it: `reason` in Drive's, `reason`
// in a Sheets API ErrorInfo's details.
function reasonsOf(json: unknown): string[] {
  const error = (json as { error?: Record<string, unknown> } | null)?.error ?? {};
  const listed = [
    ...(Array.isArray(error.errors) ? error.errors : []),
    ...(Array.isArray(error.details) ? error.details : []),
  ];
  return listed.flatMap((each) => (typeof each?.reason === "string" ? [each.reason] : []));
}

function refusalOf(status: number, json: unknown): Refusal {
  const reasons = reasonsOf(json);
  if (status === 400) {
    const message = messageOf(json);
    return new Refusal(`Google refused the request${message ? `: ${message}` : "."}`);
  }
  if (status === 401)
    return new Refusal("Google refused the sign-in. Run `sheets-mcp login` again.");
  if (status === 429 || reasons.some((r) => /rate_?limit_?exceeded/i.test(r)))
    return new Refusal("Google says too many requests just now. Wait a minute, then try again.");
  if (status === 403 && reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/.test(r)))
    return new Refusal(
      "The Google Cloud project behind this client hasn't turned on the Sheets API and the Drive API. Turn both on in the Cloud console, then try again.",
    );
  if (status === 403)
    return new Refusal("Google refused: this account can't open or change that spreadsheet.");
  if (status === 404)
    return new Refusal("Google found no spreadsheet with that ID that this account can open.");
  return new Refusal(`Google didn't answer properly (${status}). Try again in a moment.`);
}

async function call(
  google: Google,
  method: string,
  url: URL,
  body: unknown,
  again: boolean,
): Promise<unknown> {
  const access = await google.source.access(again);
  if (access.status === "refused") throw new Refusal(access.problem);
  let response: Response;
  let text: string;
  try {
    response = await google.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${access.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(requestMs),
    });
    text = await response.text();
  } catch {
    throw new Refusal("Couldn't reach Google. Check the connection, then try again.");
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (response.status === 401 && !again) return call(google, method, url, body, true);
  if (!response.ok) throw refusalOf(response.status, json);
  if (json === null || typeof json !== "object" || Array.isArray(json))
    throw new Refusal("Google's answer isn't one this server reads.");
  return json;
}

const address = (origin: string, path: string, query: Record<string, string | string[]>) => {
  const url = new URL(path, origin);
  for (const [name, value] of Object.entries(query))
    for (const each of [value].flat()) url.searchParams.append(name, each);
  return url;
};

export const drive = (google: Google, path: string, query: Record<string, string | string[]>) =>
  call(google, "GET", address(driveOrigin, path, query), undefined, false);

export const sheets = (
  google: Google,
  method: "GET" | "PUT" | "POST",
  path: string,
  query: Record<string, string | string[]>,
  body?: unknown,
) => call(google, method, address(sheetsOrigin, path, query), body, false);
