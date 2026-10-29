// A localhost server with no login is reachable from every page the user's
// browser has open, including links in synced content. So:
// - Every request must name this server in Host. A site that rebinds its own
//   domain to 127.0.0.1 sends its own name there, and is refused.
// - A request naming any other Origin is refused, whatever its method.
// - A request that can change state (anything but GET and HEAD) must carry this
//   server's own Origin. One with no Origin isn't from our page, so it's refused.

const safeMethods = new Set(["GET", "HEAD"]);

// Browsers leave the port out of Host and Origin when it is 80.
export function ownHosts(port: number): string[] {
  const suffix = port === 80 ? "" : `:${port}`;
  return [`127.0.0.1${suffix}`, `localhost${suffix}`];
}

// Why the request is refused, or null if it may go on.
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
