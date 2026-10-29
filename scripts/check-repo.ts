// Repo invariants: CLAUDE.md is a symlink to AGENTS.md; every locked package
// comes from the npm registry, is on the AGENTS.md allowlist, and is listed on
// an ADR's `Adds:` line; and outside packages/changeset, no code names
// `Approved` (core defines it) or imports an adapter's `./writer`.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

// `name@version` keys from every top-level `packages:` block.
export function lockedPackages(lockfile: string): string[] {
  const keys = new Set<string>();
  let inPackages = false;
  for (const line of lockfile.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = line === "packages:";
      continue;
    }
    if (inPackages && /^ {2}\S.*:$/.test(line))
      keys.add(line.trim().slice(0, -1).replaceAll("'", ""));
  }
  return [...keys].sort();
}

export function allowlist(agentsMd: string): string[] {
  const section = agentsMd.split(/^## Dependencies.*$/m)[1]?.split(/^## /m)[0] ?? "";
  return backticked(section);
}

export function adrAdds(adr: string): string[] {
  return [...adr.matchAll(/^Adds: (.*)$/gm)].flatMap((m) => backticked(m[1] ?? ""));
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
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
  sources: { path: string; text: string }[];
}): string[] {
  const found = new Set<string>();
  for (const { path, text } of repo.sources) {
    if (path.startsWith("packages/changeset/")) continue;
    if (!path.startsWith("packages/core/") && /\bApproved\b/.test(text)) {
      found.add(
        `${path}: names Approved outside packages/core and packages/changeset (decision 0003)`,
      );
    }
    if (/["']@oriel\/[^"']+\/writer["']/.test(text)) {
      found.add(`${path}: imports a source writer outside packages/changeset (decision 0003)`);
    }
  }
  if (repo.claudeLink !== "AGENTS.md") {
    found.add(
      `CLAUDE.md must be a symlink to exactly "AGENTS.md", got ${JSON.stringify(repo.claudeLink)}`,
    );
  }
  const keys = lockedPackages(repo.lockfile);
  if (keys.length === 0 && /^\s+specifier:/m.test(repo.lockfile)) {
    found.add("pnpm-lock.yaml: declares dependencies but no packages could be read");
  }
  const allowed = allowlist(repo.agentsMd);
  const added = new Set(repo.decisions.flatMap(adrAdds));
  for (const key of keys) {
    const at = key.indexOf("@", 1);
    const name = key.slice(0, at);
    if (!/^\d+\.\d+\.\d+/.test(key.slice(at + 1))) {
      found.add(`${key}: not from the npm registry`);
      continue;
    }
    const entry = allowed.find((e) => matches(name, e));
    if (!entry) {
      found.add(`${name}: not on the AGENTS.md dependency allowlist`);
      continue;
    }
    if (!added.has(entry)) found.add(`${entry}: no ADR lists it on an \`Adds:\` line`);
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
    sources: readdirSync("packages", { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.split("/").includes("node_modules"))
      .map((f) => ({ path: `packages/${f}`, text: readFileSync(`packages/${f}`, "utf8") })),
  });
  for (const p of found) console.error(p);
  process.exitCode = found.length ? 1 : 0;
}
