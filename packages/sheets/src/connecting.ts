// How a person connects Google Sheets in the window (decisions 0049, 0050
// and 0051): a line saying what they agree to, then Google's own page, in
// their browser, where they sign in and pick spreadsheets in one tab; then
// Oriel reads the picked tabs' headers and drafts how to read them, for the
// person to apply. The sign-in is Oriel's Google client's, which `pnpm dev`
// reads from `.env`; without it, the window says so and doesn't connect.
//
// The page opens from a link in the window, which the desktop app sends to
// the person's browser through the shell, so no command line ever holds the
// sign-in's state or PKCE challenge. The connection is named by the
// account's email, from Drive's `about`, or "Google Sheets" without one.
import {
  array,
  type ConnectOf,
  type ConnectRefusal,
  type ConnectVia,
  type Infer,
  nullable,
  number,
  object,
  type ToOpen,
  refine,
  string,
} from "@oriel/core";
import { googleClientEnv, googleClientOf, refresh, signIn, type Tokens } from "./oauth.ts";
import { picksOf, tokensOf } from "./open-connection.ts";
import { driveOrigin } from "./stand-in.ts";

const absent =
  "Google Sheets can't be connected from this copy of Oriel yet: it doesn't have Oriel's Google sign-in.";

// What the sign-in gives, which stays on the server: the tokens, the picked
// spreadsheets' IDs, and the account, by Drive's `permissionId` and its
// email when Drive gives it.
const token = refine(string, (text) => /^[\x21-\x7e]+$/.test(text), "expected a token");
const given = object({
  tokens: object({ access: token, refresh: token, expiresAt: number }),
  picked: array(refine(string, (id) => /^[A-Za-z0-9_-]{10,100}$/.test(id), "expected a file ID")),
  account: object({
    permissionId: refine(string, (id) => /^[A-Za-z0-9_-]{1,100}$/.test(id), "expected an ID"),
    email: nullable(string),
  }),
});
export type SignedIn = Infer<typeof given>;

const about = object({
  user: object({ permissionId: string, emailAddress: nullable(string) }),
});

// The account the tokens are for. `drive.file` may read `about` (OA-219);
// the email may not come, and then the connection is named for Google
// Sheets.
async function accountOf(tokens: Tokens, send: typeof fetch): Promise<SignedIn["account"] | null> {
  const url = new URL("/drive/v3/about", driveOrigin);
  url.searchParams.set("fields", "user(permissionId,emailAddress)");
  try {
    const response = await send(url, {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const json = (await response.json()) as { user?: Record<string, unknown> };
    const read = about({ user: { emailAddress: null, ...json.user } });
    if (!read.ok) return null;
    const email = read.value.user.emailAddress?.trim() ?? "";
    return {
      permissionId: read.value.user.permissionId,
      email:
        email.length > 0 && email.length <= 60 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null,
    };
  } catch {
    return null;
  }
}

// The composition root's clock, in milliseconds.
const clockOf = (via: ConnectVia) => (via.now ? () => Date.parse(via.now?.() ?? "") : Date.now);

const tryAgain = "Google's sign-in didn't finish, so nothing was connected. Try again.";

// Begins a sign-in: a loopback listener and Google's page's address, which
// the window opens; `done` settles once the person finishes there, or the
// listener closes after 5 minutes.
async function begin(
  via: ConnectVia,
): Promise<{ url: string; done: Promise<SignedIn | ConnectRefusal> } | ConnectRefusal> {
  const client = googleClientOf(via.client);
  if (!client) return { problem: absent };
  const send = via.fetch ?? fetch;
  const now = clockOf(via);
  let opened: (url: string) => void = () => {};
  const url = new Promise<string>((resolve) => (opened = resolve));
  const done = signIn(client, {
    fetch: send,
    open: async (at) => opened(at),
    now,
  }).then(async (result): Promise<SignedIn | ConnectRefusal> => {
    if (result.status === "failed") {
      via.log("sheets: the sign-in didn't finish", { problem: result.problem });
      return {
        problem: result.problem.includes("5 minutes")
          ? "Google's page wasn't finished within 5 minutes, so nothing was connected. Try again."
          : tryAgain,
      };
    }
    if (result.picked.length === 0)
      return { problem: "No spreadsheet was picked on Google's page. Try again, and pick one." };
    const account = await accountOf(result.tokens, send);
    if (!account) {
      via.log("sheets: Drive didn't say which account signed in", {});
      return { problem: tryAgain };
    }
    return { tokens: result.tokens, picked: result.picked, account };
  });
  const first = await Promise.race([
    url.then((at) => ({ at })),
    done.then((ended) => ({ ended })),
  ]).catch((error: unknown) => {
    via.log("sheets: the sign-in couldn't start", { error: String(error) });
    return { ended: { problem: tryAgain } };
  });
  if ("ended" in first) return "problem" in first.ended ? first.ended : { problem: tryAgain };
  return { url: first.at, done };
}

export const sheetsConnect = {
  steps: [
    {
      kind: "browser",
      label: "Sign in to Google",
      title: "Connect Google Sheets",
      lede: "Sign in to Google in your browser, and pick the spreadsheets Oriel reads.",
      consent:
        "Oriel reads only the spreadsheets you pick, keeps an index of them on this Mac, and sends what a question needs to your AI, under your plan.",
      go: "Continue to Google",
      waiting: "Finish on Google's page: sign in, then pick spreadsheets.",
    },
    {
      kind: "review",
      label: "How Oriel reads your spreadsheets",
      title: "How Oriel reads them",
      lede: "Each row becomes an item, under the columns below. Nothing is read until you apply it.",
      reading: "Reading the headers",
      ask: "Draft how Oriel should read the spreadsheets just picked.",
    },
  ],
  offer: {
    firstRun: 3,
    mark: "S",
    title: "Google Sheets",
    about: "Trackers, RAID logs and plans you pick",
    counts: "row",
    empty: "The picked spreadsheets have no rows Oriel reads yet.",
    yours: "your spreadsheets",
    changes: "Google Sheets",
    follow: "a row",
    ready: "Google Sheets is ready.",
    catchUp: "Google Sheets can catch up later.",
  },
  given,
  browser: { begin },
  client: { env: googleClientEnv, absent },
  identify: async (signedIn) => signedIn.account.permissionId,
  taken: (_first, live): ConnectRefusal => ({
    problem: live
      ? "Oriel reads one Google account's spreadsheets for now. Sign in with that account again."
      : "Oriel reads one Google account's spreadsheets for now: the first one connected. Sign in with that one again.",
  }),
  reads: ({ options }) => {
    const count = picksOf(options).spreadsheets.length;
    return `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}`;
  },
  // Signed in again, the mappings it had stay, and a spreadsheet picked
  // anew joins them, with no tab mapped.
  again: (kept, made) => {
    const had = picksOf(kept).spreadsheets;
    const known = new Set(had.map((pick) => pick.id));
    const added = picksOf(made).spreadsheets.filter((pick) => !known.has(pick.id));
    return { ...kept, spreadsheets: [...had, ...added] };
  },
  // The picked spreadsheets, each with no tab mapped yet, so it waits for
  // its options, which Oriel or the agent drafts (decision 0051).
  make: async (signedIn) => ({
    options: { spreadsheets: signedIn.picked.map((id) => ({ id, tabs: [] })) },
    secret: JSON.stringify(signedIn.tokens),
    ...(signedIn.account.email ? { name: signedIn.account.email } : {}),
  }),
  failed: {
    open: "Google answered, but Oriel couldn't open the spreadsheets just now. Try again.",
    sync: "Google answered, but Oriel couldn't read the spreadsheets just now. Try again.",
  },
  // A kept connection whose refresh Google refuses is signed out, so the
  // window asks for it again. One whose access token still lasts, or that
  // Google doesn't answer, opens.
  async vet(connection: ToOpen, via: ConnectVia): Promise<boolean> {
    const tokens = tokensOf(connection.secret);
    if (!tokens) return false;
    const now = clockOf(via);
    if (tokens.expiresAt > now()) return true;
    if (!tokens.refresh) return false;
    const client = googleClientOf(via.client);
    if (!client) return true;
    const refreshed = await refresh(client, tokens.refresh, {
      fetch: via.fetch ?? fetch,
      now,
    });
    return refreshed.status !== "signed-out";
  },
} satisfies ConnectOf<SignedIn, never>;
