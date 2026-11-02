// What the server reads from `.env`: Jira's site, email and API token, for
// writer config and a live sync, and the model key. Nothing else is read,
// and no message includes a value.
import { parseEnv } from "node:util";
import { anthropicKey } from "@oriel/agent";

// The only site the server reads from and writes to (SPEC §4).
export const throwawaySite = "https://oriel.atlassian.net";

export type ServerEnv = {
  jira: { site: string; email: string; token: string } | { problem: string };
  modelKey: string | null;
};

export function serverEnv(envFile: string | null): ServerEnv {
  const env = envFile ? parseEnv(envFile) : {};
  const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = env;
  const jira =
    !site || !email || !token
      ? { problem: "JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must all be set in .env" }
      : !URL.canParse(site) || new URL(site).origin !== throwawaySite
        ? { problem: `JIRA_SITE must be the throwaway site, ${throwawaySite}` }
        : { site: throwawaySite, email, token };
  return { jira, modelKey: anthropicKey(envFile) };
}

// The Slack token a live Slack source reads with: the first user token in
// SLACK_USER_TOKENS, the person who authorized the app first (OA-22's
// `pnpm seed:slack --add`). Read only when the server is asked for live
// Slack, and never in a message.
export function slackEnv(envFile: string | null): { token: string } | { problem: string } {
  const env = envFile ? parseEnv(envFile) : {};
  const [token] = (env.SLACK_USER_TOKENS ?? "").split(/\s+/).filter(Boolean);
  if (!token) return { problem: "SLACK_USER_TOKENS must hold a user token in .env" };
  if (!token.startsWith("xoxp-"))
    return { problem: "SLACK_USER_TOKENS holds something that isn't a user token" };
  return { token };
}
