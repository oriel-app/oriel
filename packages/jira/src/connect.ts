// Before Oriel keeps a connection the user typed: whether the site takes the
// account's credentials, then whether that account can see the project.
// Nothing is synced or kept here. A request that fails to send throws.
import { api, projectKey } from "./rest.ts";
import type { ReadTransport } from "./transport.ts";

export type ConnectionCheck = "ok" | "refused" | "no-project" | "unexpected";

export async function checkConnection(
  transport: ReadTransport,
  project: string,
): Promise<ConnectionCheck> {
  if (!projectKey.test(project)) return "no-project";
  const me = await transport({ method: "GET", path: `${api}/myself` });
  if (me.status === 401 || me.status === 403) return "refused";
  if (me.status !== 200) return "unexpected";
  // Jira answers 404 both for a project that doesn't exist and for one this
  // account can't see.
  const found = await transport({ method: "GET", path: `${api}/project/${project}` });
  if (found.status === 404 || found.status === 403) return "no-project";
  return found.status === 200 ? "ok" : "unexpected";
}
