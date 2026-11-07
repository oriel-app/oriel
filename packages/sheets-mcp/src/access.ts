// Where a tool call's access token comes from: the refresh token `login`
// kept, exchanged for an access token held in memory until a minute before
// it expires, or Google refuses it. The server never signs in on its own.
import { type Fetch, type GoogleClient, refresh, type Tokens } from "./oauth.ts";
import type { TokenFile } from "./token-file.ts";

export const notSignedIn = "Not signed in. Run `sheets-mcp login`.";

export type Access = { status: "ok"; token: string } | { status: "refused"; problem: string };

export type AccessSource = {
  // `again`: Google refused the last token, so get another.
  access(again?: boolean): Promise<Access>;
  // What must never be shown: the client's ID and secret, and every token.
  secrets(): string[];
};

// Fixture mode's: one made-up token, and nothing to hide.
export const fixedAccess = (token: string): AccessSource => ({
  access: async () => ({ status: "ok", token }),
  secrets: () => [],
});

const earlyMs = 60_000;

// A client ID starts with its Cloud project's number, which Google's own
// errors quote, such as `123456789012-abc.apps.googleusercontent.com`.
const projectOf = (id: string) => /^([0-9]{6,})-/.exec(id)?.slice(1) ?? [];

export function googleAccess(deps: {
  // The client to refresh with, read at each refresh; null when there's
  // none, as before the first `login`.
  client: () => GoogleClient | null;
  file: TokenFile;
  fetch: Fetch;
  // Milliseconds since the epoch.
  now: () => number;
}): AccessSource {
  const { file } = deps;
  let held: Tokens | null = null;
  let pending: Promise<Access> | null = null;
  const seen = new Set<string>();

  // Each client refreshed with, whose ID and secret are never shown.
  const clients: GoogleClient[] = [];

  async function renew(): Promise<Access> {
    // Read each time, so a `login` while the server runs is used at once.
    const client = deps.client();
    const kept = file.read();
    if (!client || kept === null) return { status: "refused", problem: notSignedIn };
    clients.push(client);
    seen.add(kept);
    const refreshed = await refresh(client, kept, deps);
    if (refreshed.status === "signed-out")
      return {
        status: "refused",
        problem: "The Google sign-in expired or was revoked. Run `sheets-mcp login`.",
      };
    if (refreshed.status === "failed")
      return { status: "refused", problem: `Couldn't refresh the sign-in: ${refreshed.problem}.` };
    held = refreshed.tokens;
    seen.add(held.access);
    seen.add(held.refresh);
    if (held.refresh !== kept) file.write(held.refresh);
    return { status: "ok", token: held.access };
  }

  return {
    async access(again = false) {
      if (again) held = null;
      if (held && deps.now() < held.expiresAt - earlyMs)
        return { status: "ok", token: held.access };
      // Calls at once share one refresh.
      pending ??= renew().finally(() => (pending = null));
      return pending;
    },
    secrets: () => {
      const current = deps.client();
      return [
        ...new Set([
          ...[...clients, ...(current ? [current] : [])].flatMap((client) => [
            client.id,
            ...projectOf(client.id),
            ...(client.secret ? [client.secret] : []),
          ]),
          ...seen,
        ]),
      ];
    },
  };
}
