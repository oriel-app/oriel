// Signing an outside tool in with OAuth (MCP's authorization, 2025-06-18 and
// after), with the consent in Oriel's own window. The door is the protected
// resource and its own authorization server. A client that meets a 401
// finds this server's metadata, registers itself, and opens the person's
// browser at /authorize with PKCE. That page decides nothing: it shows a
// short code and waits. The window, which only the person's own page
// reaches (decision 0036), shows the same code with the name the client
// gave, and the person lets it in, read only or read and act, under a name
// of their own, or turns it away. Only then does the browser go back to the
// client, with a code its PKCE verifier alone can spend for a token.
//
// What it accepts:
// - redirects only to loopback, over http, at any port (RFC 8252), since
//   every MCP client the person runs is a program on their machine;
// - S256 PKCE only, public clients only (no client secret);
// - a code once, within a minute; an ask, within ten, and one a client;
// - a sign-in the browser opened from outside any page: one a page or a
//   link in synced content navigates to, which another account on the
//   machine could have registered, is refused.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Reply } from "../site.ts";
import type { OutsideTools, ToolMode } from "./tokens.ts";
import { accessLife } from "./tokens.ts";

export type Ask = {
  id: string;
  // The client's own name for itself, as it registered: never trusted.
  says: string;
  // What the browser and the window both show, for the person to match.
  code: string;
  // Where the sign-in goes back to: a port on loopback.
  returnsTo: string;
  asked: number;
};

type Client = { id: string; name: string; redirects: string[]; at: number };
type Pending = Ask & {
  clientId: string;
  redirect: string;
  challenge: string;
  state: string | null;
  decided?: { code: string } | { denied: true };
};
type Code = {
  clientId: string;
  redirect: string;
  challenge: string;
  name: string;
  mode: ToolMode;
  says: string;
  redirects: string[];
  at: number;
};

const askLife = 10 * 60 * 1000;
const codeLife = 60 * 1000;
const maxClients = 50;
const maxAsks = 5;
// Letters a person can't misread for another, for the code they match.
const letters = "ACDEFHJKMNPRTUVWXY";

const html = (status: number, title: string, body: string, refresh?: string): Reply => ({
  status,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...(refresh ? { refresh } : {}),
  },
  body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1>${body}</body></html>`,
});
const escaped = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).slice(0, 200);
const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(value),
});
const oauthError = (error: string, description: string) =>
  json(400, { error, error_description: description });

// A redirect a native client may use: http, to loopback, with no fragment.
export function isLoopbackRedirect(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}

// RFC 8252 §7.3: a loopback redirect matches whatever port it comes back on.
const sameRedirect = (registered: string, asked: string) => {
  const [a, b] = [new URL(registered), new URL(asked)];
  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search
  );
};

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function oauth(deps: {
  tools: Pick<OutsideTools, "grant" | "refresh">;
  // The door's origin, such as http://127.0.0.1:4331, and its MCP endpoint.
  origin: string;
  clock(): number;
  // Told when a client asks to be let in, so the window can come forward.
  asked?(ask: Ask): void;
}) {
  const clients = new Map<string, Client>();
  const pending = new Map<string, Pending>();
  const codes = new Map<string, Code>();
  const resource = `${deps.origin}/mcp`;
  const prune = () => {
    const now = deps.clock();
    for (const [id, ask] of pending) if (now - ask.asked > askLife) pending.delete(id);
    for (const [code, at] of codes) if (now - at.at > codeLife) codes.delete(code);
  };

  const metadata = {
    issuer: deps.origin,
    authorization_endpoint: `${deps.origin}/authorize`,
    token_endpoint: `${deps.origin}/token`,
    registration_endpoint: `${deps.origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["oriel"],
  };
  const protectedResource = {
    resource,
    authorization_servers: [deps.origin],
    bearer_methods_supported: ["header"],
    resource_name: "Oriel",
    scopes_supported: ["oriel"],
  };

  function register(body: string): Reply {
    let asked: Record<string, unknown>;
    try {
      asked = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return oauthError("invalid_client_metadata", "expected JSON");
    }
    const redirects = asked["redirect_uris"];
    if (
      !Array.isArray(redirects) ||
      redirects.length === 0 ||
      redirects.length > 5 ||
      !redirects.every((each) => typeof each === "string" && isLoopbackRedirect(each))
    )
      return oauthError("invalid_redirect_uri", "Oriel signs in only programs on this machine");
    const method = asked["token_endpoint_auth_method"] ?? "none";
    if (method !== "none") return oauthError("invalid_client_metadata", "public clients only");
    const name =
      typeof asked["client_name"] === "string" && asked["client_name"].trim()
        ? asked["client_name"].trim().slice(0, 60)
        : "A program";
    const id = `oc_${randomBytes(16).toString("base64url")}`;
    const at = deps.clock();
    clients.set(id, { id, name, redirects: redirects as string[], at });
    if (clients.size > maxClients) clients.delete(clients.keys().next().value as string);
    return json(201, {
      client_id: id,
      client_id_issued_at: Math.floor(at / 1000),
      client_name: name,
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  function authorize(params: URLSearchParams, site: string | undefined): Reply {
    prune();
    // A browser says where a navigation came from; `none` is the address
    // bar or another program opening it, as a client does.
    if (site !== undefined && site !== "none")
      return html(
        403,
        "Oriel can't sign this program in",
        "<p>A sign-in starts from the program itself, never from a link on a page.</p>",
      );
    const client = clients.get(params.get("client_id") ?? "");
    const redirect = params.get("redirect_uri") ?? client?.redirects[0] ?? "";
    // Nothing is sent back to a redirect Oriel can't vouch for.
    if (!client || !client.redirects.some((each) => sameRedirect(each, redirect)))
      return html(400, "Oriel can't sign this program in", "<p>It isn't registered here.</p>");
    const refuse = (query: Record<string, string>): Reply => {
      const url = new URL(redirect);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const state = params.get("state");
      if (state !== null) url.searchParams.set("state", state);
      url.searchParams.set("iss", deps.origin);
      return {
        status: 302,
        headers: { location: url.href, "cache-control": "no-store" },
        body: "",
      };
    };
    if (params.get("response_type") !== "code")
      return refuse({ error: "unsupported_response_type" });
    const challenge = params.get("code_challenge") ?? "";
    if (params.get("code_challenge_method") !== "S256" || !/^[\w-]{43,128}$/.test(challenge))
      return refuse({ error: "invalid_request", error_description: "S256 PKCE is required" });
    const named = params.get("resource");
    if (named !== null && named !== resource && named !== deps.origin)
      return refuse({ error: "invalid_target" });
    // A client asking again replaces its ask, and brings the window
    // forward only the first time.
    const before = [...pending.values()].find((each) => each.clientId === client.id);
    if (before) pending.delete(before.id);
    if (pending.size >= maxAsks)
      return refuse({ error: "temporarily_unavailable", error_description: "too many asks" });
    const id = randomBytes(24).toString("base64url");
    const code = Array.from(randomBytes(4), (b) => letters[b % letters.length]).join("");
    pending.set(id, {
      id,
      says: client.name,
      code,
      returnsTo: new URL(redirect).host,
      asked: deps.clock(),
      clientId: client.id,
      redirect,
      challenge,
      state: params.get("state"),
    });
    if (!before) deps.asked?.(publicAsk(pending.get(id)!));
    return waiting(id);
  }

  // Back to the client's redirect, with the answer and the state it sent.
  const back = (ask: Pending, query: Record<string, string>): Reply => {
    const url = new URL(ask.redirect);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (ask.state !== null) url.searchParams.set("state", ask.state);
    url.searchParams.set("iss", deps.origin);
    return { status: 302, headers: { location: url.href, "cache-control": "no-store" }, body: "" };
  };

  const publicAsk = (ask: Pending): Ask => ({
    id: ask.id,
    says: ask.says,
    code: ask.code,
    returnsTo: ask.returnsTo,
    asked: ask.asked,
  });

  // The browser's page while the person decides in the window: it looks
  // again every two seconds, with no script.
  function waiting(id: string): Reply {
    const ask = pending.get(id);
    if (!ask) return html(410, "This sign-in has ended", "<p>Start it again from the program.</p>");
    if (ask.decided) {
      pending.delete(id);
      return "denied" in ask.decided
        ? back(ask, { error: "access_denied" })
        : back(ask, { code: ask.decided.code });
    }
    return html(
      200,
      "Let this program into Oriel",
      `<p><b>${escaped(ask.says)}</b> asks to use Oriel.</p>` +
        `<p>Oriel's window shows the same code: <b>${ask.code}</b>. Let it in there, or turn it away.</p>` +
        "<p>This page goes on by itself.</p>",
      `2; url=/authorize/wait?ask=${id}`,
    );
  }

  function wait(params: URLSearchParams): Reply {
    prune();
    return waiting(params.get("ask") ?? "");
  }

  function token(body: string): Reply {
    prune();
    const form = new URLSearchParams(body);
    const grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (grant === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (!code || code.clientId !== clientId)
        return oauthError("invalid_grant", "the code is spent, expired or another client's");
      const redirect = form.get("redirect_uri");
      if (redirect !== null && !sameRedirect(code.redirect, redirect))
        return oauthError("invalid_grant", "redirect_uri doesn't match");
      if (!same(s256(form.get("code_verifier") ?? ""), code.challenge))
        return oauthError("invalid_grant", "PKCE verification failed");
      const granted = deps.tools.grant(code.name, code.mode, code.says, {
        id: clientId,
        redirects: code.redirects,
      });
      return json(200, {
        access_token: granted.access,
        token_type: "Bearer",
        expires_in: accessLife / 1000,
        refresh_token: granted.refresh,
        scope: "oriel",
      });
    }
    if (grant === "refresh_token") {
      const renewed = deps.tools.refresh(form.get("refresh_token") ?? "", clientId);
      if (!renewed) return oauthError("invalid_grant", "sign in again");
      return json(200, {
        access_token: renewed.access,
        token_type: "Bearer",
        expires_in: accessLife / 1000,
        refresh_token: renewed.refresh,
        scope: "oriel",
      });
    }
    return oauthError("unsupported_grant_type", "authorization_code or refresh_token");
  }

  return {
    // Where a 401 points a client.
    resourceMetadata: `${deps.origin}/.well-known/oauth-protected-resource/mcp`,
    // The door's reply for an OAuth path, or null for any other.
    async handle(
      method: string,
      url: URL,
      body: () => Promise<string | null>,
      // The request's `Sec-Fetch-Site`, when a browser sent one.
      site?: string,
    ): Promise<Reply | null> {
      const path = url.pathname;
      if (method === "GET" && path.startsWith("/.well-known/oauth-protected-resource"))
        return json(200, protectedResource);
      if (method === "GET" && path === "/.well-known/oauth-authorization-server")
        return json(200, metadata);
      if (method === "GET" && path === "/authorize") return authorize(url.searchParams, site);
      if (method === "GET" && path === "/authorize/wait") return wait(url.searchParams);
      if (method === "POST" && (path === "/register" || path === "/token")) {
        const text = await body();
        if (text === null) return oauthError("invalid_request", "too large");
        return path === "/register" ? register(text) : token(text);
      }
      return null;
    },
    // What the window shows: each client waiting on the person.
    asks(): Ask[] {
      prune();
      return [...pending.values()].filter((ask) => !ask.decided).map(publicAsk);
    },
    // The person's answer, from the window: in, under their name for it and
    // a mode, or turned away. False when the ask is gone.
    decide(id: string, answer: { name: string; mode: ToolMode } | "deny"): boolean {
      prune();
      const ask = pending.get(id);
      if (!ask || ask.decided) return false;
      if (answer === "deny") {
        ask.decided = { denied: true };
        return true;
      }
      const client = clients.get(ask.clientId);
      if (!client) return false;
      const code = randomBytes(32).toString("base64url");
      codes.set(code, {
        clientId: ask.clientId,
        redirect: ask.redirect,
        challenge: ask.challenge,
        name: answer.name,
        mode: answer.mode,
        says: ask.says,
        redirects: client.redirects,
        at: deps.clock(),
      });
      ask.decided = { code };
      return true;
    },
  };
}
export type OAuth = ReturnType<typeof oauth>;
