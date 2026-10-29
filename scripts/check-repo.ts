// Repo invariants: CLAUDE.md is a symlink to AGENTS.md, and every locked
// package is on the AGENTS.md allowlist and named by an ADR.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

export function lockedPackages(lockfile: string): string[] {
  const section = lockfile.split(/^packages:\n/m)[1]?.split(/^\S/m)[0] ?? "";
  const keys = (section.match(/^ {2}\S.*:$/gm) ?? []).map((line) =>
    line.trim().slice(0, -1).replaceAll("'", ""),
  );
  return [...new Set(keys.map((key) => key.slice(0, key.indexOf("@", 1))))].sort();
}

export function allowlist(agentsMd: string): string[] {
  const section = agentsMd.split(/^## Dependencies.*$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
}

export function matches(name: string, entry: string): boolean {
  if (entry.endsWith("*")) return name.startsWith(entry.slice(0, -1));
  return name === entry;
}

export function problems(repo: {
  claudeLink: string;
  lockfile: string;
  agentsMd: string;
  decisions: string[];
}): string[] {
  const found = new Set<string>();
  if (repo.claudeLink !== "AGENTS.md") {
    found.add(
      `CLAUDE.md must be a symlink to exactly "AGENTS.md", got ${JSON.stringify(repo.claudeLink)}`,
    );
  }
  const allowed = allowlist(repo.agentsMd);
  for (const name of lockedPackages(repo.lockfile)) {
    const entry = allowed.find((e) => matches(name, e));
    if (!entry) {
      found.add(`${name}: not on the AGENTS.md dependency allowlist`);
      continue;
    }
    if (!repo.decisions.some((adr) => adr.includes(`\`${entry}\``))) {
      found.add(`${entry}: no ADR in docs/decisions/ names it`);
    }
  }
  return [...found];
}

function readLink(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "(not a symlink)";
  }
}

if (import.meta.main) {
  const found = problems({
    claudeLink: readLink("CLAUDE.md"),
    lockfile: readFileSync("pnpm-lock.yaml", "utf8"),
    agentsMd: readFileSync("AGENTS.md", "utf8"),
    decisions: readdirSync("docs/decisions")
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(`docs/decisions/${f}`, "utf8")),
  });
  for (const p of found) console.error(p);
  process.exitCode = found.length ? 1 : 0;
}
