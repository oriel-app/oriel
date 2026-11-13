// A localhost server with no login is reachable from every page the browser has open. So every request must name this
// server in Host (a rebound domain sends its own), no other Origin is allowed, and a state change must carry our own Origin.
import { createHash, timingSafeEqual } from "node:crypto";

const safeMethods = new Set(["GET", "HEAD"]);

// Browsers leave the port out of Host and Origin when it is 80.
export function ownHosts(port: number): string[] {
  const suffix = port === 80 ? "" : `:${port}`;
  return [`127.0.0.1${suffix}`, `localhost${suffix}`];
}

export function refusal(
  method: string,
  headers: { host?: string; origin?: string },
  port: number,
): string | null {
  const hosts = ownHosts(port);
  const host = headers.host?.toLowerCase();
  if (host === undefined || !hosts.includes(host)) return "Host is not this server";
  const origin = headers.origin?.toLowerCase();
  const own = origin !== undefined && hosts.some((name) => origin === `http://${name}`);
  if (origin !== undefined && !own) return "Origin is not this server";
  if (!safeMethods.has(method) && !own)
    return "a request that changes state needs this server's Origin";
  return null;
}

// Loopback is shared by every account on the machine, and a page in the browser can still send GETs, so the desktop server
// answers only requests carrying the launch secret, compared in constant time. A Cookie header may name it more than once.
export function hasLaunchSecret(
  cookies: string | undefined,
  name: string,
  secret: string,
): boolean {
  const want = createHash("sha256").update(secret).digest();
  let found = false;
  for (const pair of (cookies ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at === -1 || pair.slice(0, at).trim() !== name) continue;
    const got = createHash("sha256")
      .update(pair.slice(at + 1).trim())
      .digest();
    if (timingSafeEqual(got, want)) found = true;
  }
  return found;
}
