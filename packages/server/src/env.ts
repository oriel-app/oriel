// What the server reads from `.env`: Jira's site, email and API token, for
// writer config and a live sync, and the model key. Nothing else is read,
// and no message includes a value.
import { parseEnv } from "node:util";

// The only site the server reads from and writes to (SPEC §4).
export const throwawaySite = "https://oriel.atlassian.net";

export type ServerEnv = {
  jira: { site: string; email: string; token: string } | { problem: string };
  modelKey: string | null;
};

export function serverEnv(envFile: string | null): ServerEnv {
  const env = envFile ? parseEnv(envFile) : {};
  const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = env;
  const key = env.ANTHROPIC_API_KEY?.trim();
  const jira =
    !site || !email || !token
      ? { problem: "JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must all be set in .env" }
      : !URL.canParse(site) || new URL(site).origin !== throwawaySite
        ? { problem: `JIRA_SITE must be the throwaway site, ${throwawaySite}` }
        : { site: throwawaySite, email, token };
  return { jira, modelKey: key ? key : null };
}
