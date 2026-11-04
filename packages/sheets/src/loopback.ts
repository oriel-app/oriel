// The loopback redirect of Google's sign-in for installed apps (decision
// 0050): for each sign-in, a listener on 127.0.0.1 and a port the system picks,
// so never the server's own. It takes one request, which must be the redirect
// to its one path with this sign-in's `state`, answers it and closes. Nothing
// else is ever answered: a second request finds the port closed, and a request
// that isn't the redirect ends the sign-in. It closes after 5 minutes if no
// request comes.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const signInMs = 5 * 60_000;

// Calls `fire` once after `ms`, unless the function it returns is called
// first. Tests pass their own, so none waits.
export type After = (ms: number, fire: () => void) => () => void;

export const after: After = (ms, fire) => {
  const timer = setTimeout(fire, ms);
  return () => clearTimeout(timer);
};

export type Redirect =
  | { status: "redirected"; query: URLSearchParams }
  | { status: "refused"; problem: string }
  | { status: "timed-out" };

export type Loopback = {
  // The address Google sends the browser back to, such as
  // `http://127.0.0.1:52144/`.
  redirectUri: string;
  // Settles once: with the redirect's query, or why there is none.
  redirect: Promise<Redirect>;
  // Stops listening, if it still is; `redirect` then settles as refused.
  close(): void;
};

const host = "127.0.0.1";
const path = "/";

// Error codes are Google's fixed words; anything else isn't quoted.
const errorCode = /^[a-z_]{1,64}$/;

const sameState = (got: string, want: string) => {
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

function check(request: IncomingMessage, origin: string, state: string): Redirect {
  if (request.method !== "GET") return { status: "refused", problem: "a request that isn't GET" };
  // A page that rebinds a name of its own to 127.0.0.1 still sends that name.
  if (`http://${request.headers.host ?? ""}` !== origin)
    return { status: "refused", problem: "a request for another host" };
  // Only a path, read against this origin: an absolute target can't name
  // another host, and one that doesn't parse can't throw.
  const target = `${origin}${request.url ?? ""}`;
  if (!request.url?.startsWith("/") || !URL.canParse(target))
    return { status: "refused", problem: "a request to another path" };
  const url = new URL(target);
  if (url.pathname !== path) return { status: "refused", problem: "a request to another path" };
  const query = url.searchParams;
  const states = query.getAll("state");
  if (states.length !== 1 || !sameState(states[0] ?? "", state))
    return { status: "refused", problem: "a redirect whose state isn't this sign-in's" };
  const error = query.get("error");
  if (error !== null)
    return {
      status: "refused",
      problem: errorCode.test(error) ? `Google said ${error}` : "Google refused",
    };
  if (query.getAll("code").length !== 1)
    return { status: "refused", problem: "a redirect with no code" };
  return { status: "redirected", query };
}

const pages = {
  redirected: "Signed in. You can close this tab and go back to Oriel.",
  refused: "This sign-in didn't work. Go back to Oriel to try again.",
};

function answer(response: ServerResponse, ok: boolean, done: () => void) {
  response.writeHead(ok ? 200 : 400, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(ok ? pages.redirected : pages.refused, done);
}

export async function loopback(state: string, wait: After = after): Promise<Loopback> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://${host}:${port}`;

  let settle: (redirect: Redirect) => void = () => {};
  const redirect = new Promise<Redirect>((resolve) => (settle = resolve));
  let open = true;
  let cancel = () => {};
  const shut = (result: Redirect) => {
    if (!open) return false;
    open = false;
    cancel();
    server.close();
    settle(result);
    return true;
  };
  cancel = wait(signInMs, () => {
    shut({ status: "timed-out" });
    server.closeAllConnections();
  });

  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const result = check(request, origin, state);
    // A request after the first, on a connection opened before it closed.
    if (!shut(result)) {
      response.destroy();
      return;
    }
    answer(response, result.status === "redirected", () => server.closeAllConnections());
  });

  return {
    redirectUri: `${origin}${path}`,
    redirect,
    close: () => {
      shut({ status: "refused", problem: "the sign-in was closed" });
      server.closeAllConnections();
    },
  };
}
