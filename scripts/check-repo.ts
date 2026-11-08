// Repo invariants: CLAUDE.md is a symlink to AGENTS.md; every locked package
// comes from the npm registry, is on the AGENTS.md allowlist, and is listed on
// an ADR's `Adds:` line; outside packages/changeset, no code names
// `Approved` or `SourceWriter` (core defines them); and nothing but
// packages/changeset/src/writers.ts, which builds every writer, imports a
// writer by any path. An adapter's own `src/writer.ts` and its test are the
// exceptions; the test may stand in for an approval, which nothing else may
// (decision 0003). And no package imports a source adapter except the
// adapter itself, the list of sources (packages/sources), the composition
// root (packages/server), the eval harness (packages/evals) and tests, and
// only the last three import the list: other packages get a source's
// behaviour as declarations typed by core (decision 0019). A writer import is refused by
// both rules, wherever 0003 refuses it. Packages reach each other only
// through `@oriel/<name>` and its declared exports, never a relative path into
// another package; a relative path into scripts/ (the fixture tooling) is
// fine. Every route of the window's has a program's way in through the MCP
// door, or says why not (decision 0058). Oriel's own actions keep their doors in step (decision 0024): an
// action closed to a door, a person's action, or a direct one with no
// inverse says why, and an inverse names an action; and every POST route in
// packages/server changes state only through the dispatcher, apart from the
// three exempt below, which must be as the list says. What a route does
// besides dispatching is its author's word: the check sees only whether it
// dispatches. And window.css's themes pass decision 0034's rules
// (check-themes.ts), and no two decisions share a number. And every Chrome
// a script launches is the installed, auto-updated one, with its sandbox on.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { posix } from "node:path";
import { type ActionDeclaration, actions } from "../packages/core/src/actions.ts";
import { sourceKinds } from "../packages/sources/src/index.ts";
import { windowRoutes } from "../packages/server/src/mcp/parity.ts";
import { windowReads } from "../packages/server/src/mcp/reads.ts";
import { themeProblems } from "./check-themes.ts";

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

const adapters: readonly string[] = sourceKinds;

// The one file that builds writers, and an adapter's own writer and its test:
// `packages/<kind>/src/writer.ts` for a declared kind only.
const writersFile = "packages/changeset/src/writers.ts";
const ownWriterFile = new RegExp(
  `^packages/(?:${sourceKinds.join("|")})/src/writer(?:\\.test)?\\.ts$`,
);

// A specifier: a quoted string, or a template literal in `import(…)`, the one
// place a template literal can name a module, so long as it has no `${…}`,
// which can't be read without running the code. (Elsewhere, backticks are
// code in a comment.)
const open = "(?:[\"']|\\bimport\\s*\\(\\s*`)";
const inside = "[^\"'`\\s$]";
const close = "[\"'`]";
const writerImport = new RegExp(`${open}${inside}*/writer(?:\\.ts)?${close}`);
const packageSpecifier = new RegExp(`${open}@oriel/([a-z0-9-]+)(/${inside}*)?${close}`, "g");
const relativeSpecifier = new RegExp(`${open}(\\.{1,2}/${inside}*)${close}`, "g");

// The source adapters a file imports: an `@oriel/<kind>` specifier, with or
// without a subpath, or a relative path into `packages/<kind>/`, for each
// `<kind>` in core's source kinds, and whether the import is its writer.
export function importedAdapters(path: string, text: string): { kind: string; writer: boolean }[] {
  const found = new Map<string, { kind: string; writer: boolean }>();
  const add = (kind: string, target: string) => {
    const writer = /\/writer(\.ts)?$/.test(target);
    if (adapters.includes(kind)) found.set(`${kind} ${writer}`, { kind, writer });
  };
  for (const [, kind = "", sub = ""] of text.matchAll(packageSpecifier)) add(kind, sub);
  for (const [, relative = ""] of text.matchAll(relativeSpecifier)) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), relative));
    add(/^packages\/([^/]+)\//.exec(resolved)?.[1] ?? "", resolved);
  }
  return [...found.values()];
}

// Whether a file imports the list of sources, which imports every adapter,
// so it may be imported only where they may.
const importsSourceList = (text: string) =>
  [...text.matchAll(packageSpecifier)].some(([, name]) => name === "sources");

// Where a source adapter may be imported from: its own package, the list of
// sources, the composition root, the eval harness, the stand-in MCP servers,
// and tests and their support files. Its
// writer, only where decision 0003 allows: the file that builds writers, and
// the adapter's own writer and its test.
function mayImportAdapter(path: string, kind: string, writer: boolean): boolean {
  if (writer)
    return (
      path === writersFile || (path.startsWith(`packages/${kind}/`) && ownWriterFile.test(path))
    );
  if (path.startsWith(`packages/${kind}/`)) return true;
  if (/^packages\/(?:sources|server|evals)\//.test(path)) return true;
  // The stand-in MCP servers answer from each source's own fixture world, in
  // dev and tests only, never bundled (OA-276).
  if (path.startsWith("packages/standin-mcp/")) return true;
  return testFile.test(path);
}

// Tests and their support files.
const testFile = /(?:^|\/)(?:testing|[^/]+\.test)\.tsx?$/;

// Relative specifiers in import syntax: `from "…"`, `import "…"` and
// `import("…")`. Other strings that look like paths aren't imports.
const relativeImports = new RegExp(
  `(?:\\bfrom|\\bimport)\\s*\\(?\\s*["'\`](\\.{1,2}/${inside}*)${close}`,
  "g",
);

// The other packages a file under packages/ imports by a relative path.
export function crossPackageImports(path: string, text: string): string[] {
  const own = /^packages\/([^/]+)\//.exec(path)?.[1];
  if (!own) return [];
  const found = new Set<string>();
  for (const [, relative = ""] of text.matchAll(relativeImports)) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), relative));
    const other = /^packages\/([^/]+)(?:\/|$)/.exec(resolved)?.[1];
    if (other !== undefined && other !== own) found.add(other);
  }
  return [...found];
}

// The page keeps no list of sources: it draws each connector from what the
// server sends of its declaration (decision 0049). So no file in
// packages/web/src but a test names one, by its kind in any case, or Sheets,
// the next, apart from the files below, each until what it holds is drawn
// from declarations too. A listed file that names none comes off the list.
const sourceWords = [...new Set([...sourceKinds, "sheets"])];
const sourceWord = new RegExp(sourceWords.join("|"), "i");
// The folder step (decision 0049) names a kind of step, not the folder's
// connector: its kind once, as `folderStep`, and the folder picker it opens.
const folderStepWords =
  /\bfolder (?:step|picker)s?\b|\b(?:F|f)older(?:Step|Kind)\b|"folder" as const/g;
export const webNamingSources: Record<string, string> = {
  "packages/web/src/setup-page.tsx":
    "the first run's own words, that Claude Code installs nothing outside your own folder",
};

// Whether a file of the page's names a source where it shouldn't, or is
// listed and no longer does.
export function webSourceNames(path: string, text: string): string[] {
  if (!path.startsWith("packages/web/src/") || testFile.test(path)) return [];
  const names = sourceWord.exec(text.replace(folderStepWords, ""))?.[0];
  if (path in webNamingSources)
    return names === undefined
      ? [`scripts/check-repo.ts: ${path} names no source now; take it off webNamingSources`]
      : [];
  return names === undefined
    ? []
    : [
        `${path}: names a source ("${names}"); the page draws each connector from its declaration, as the server sends it (decision 0049)`,
      ];
}

// POST routes that change none of Oriel's state, and why.
export const exemptRoutes: Record<string, string> = {
  "/telemetry": "the window's own telemetry",
  "/change-sets/:id/diff": "a read that records what was shown",
  "/review/open": "a read that records what was shown",
  // Decision 0041: no agent or outside tool may pick which CLI runs.
  "/settings": "the person's own settings, which no agent may change",
  "/settings/look": "the person's own settings, which no agent may change",
  "/settings/key": "the person's own API key, which no agent may set or see",
  "/settings/usage": "a read of the person's own plan, which starts their CLI and keeps nothing",
  // Decision 0038: what runs on the person's machine, and their sign-in.
  "/setup/cli": "the person's own CLI, which no agent may install or sign in",
  "/setup/ai": "the person's own choice of AI, which no agent may make",
  "/setup/progress": "the person's own first run, which no agent may move",
  // Decision 0059: what the person's agent lists, which turns nothing on.
  "/servers/look":
    "a look at the person's agent's own servers, which starts them and turns nothing on",
  // Decision 0059: what a person picks through a source server, such as
  // Jira's projects.
  "/connections/:id/pick":
    "a read of a list to pick from, through a connection's source server, which keeps nothing",
  // OA-232: a mapping redrawn as the person edits it; applying it dispatches.
  "/connections/:id/review":
    "a draft redrawn from the source with the person's edit, which keeps nothing",
  // Decision 0058: who may use the MCP door is the person's call alone.
  "/outside-tools": "the person connecting an outside tool, which no agent or tool may do",
  "/outside-tools/:id/revoke": "the person revoking an outside tool, which no agent or tool may do",
};

// A file's POST routes, by the path each declares (`at("…")`, or a regex
// literal as written), and whether its code calls the dispatcher. A route's
// code runs to the next route's `method`.
export function postRoutes(text: string): { path: string; dispatches: boolean }[] {
  const starts = [...text.matchAll(/\bmethod: "(GET|POST)"/g)];
  return starts.flatMap((start, i) => {
    if (start[1] !== "POST") return [];
    const code = text.slice(start.index, starts[i + 1]?.index ?? text.length);
    const path = /\bpath: (?:at\("([^"]*)"\)|(\/.*\/)[a-z]*),/.exec(code);
    return [
      {
        path: path?.[1] ?? path?.[2] ?? "(unread path)",
        dispatches: /\bdispatch(?:\.untyped)?\(/.test(code),
      },
    ];
  });
}

// Each of a file's routes, as `METHOD /path` (a regex literal as written),
// and the actions it dispatches by name. A route's code runs to the next
// route's `method`.
export function routesOf(text: string): { route: string; actions: string[] }[] {
  const starts = [...text.matchAll(/\bmethod: "(GET|POST)",/g)];
  return starts.map((start, i) => {
    const code = text.slice(start.index, starts[i + 1]?.index ?? text.length);
    const path = /\bpath: (?:at\("([^"]*)"\)|(\/.*\/)[a-z]*),/.exec(code);
    const named = [...code.matchAll(/\bdispatch(?:\.untyped)?\(\s*"([a-z.-]+)"/g)];
    return {
      route: `${start[1]} ${path?.[1] ?? path?.[2] ?? "(unread path)"}`,
      actions: [...new Set(named.map((each) => each[1] ?? ""))],
    };
  });
}

// Parity (decision 0058): every route of the window's is something a program can do
// or read too, or says why not. A route is covered by one of the window's
// reads (packages/server/src/mcp/reads.ts), by the one action it dispatches,
// whose declaration makes it a tool or says why not (decision 0024), or by
// its line in packages/server/src/mcp/parity.ts.
export function parityProblems(
  routes: readonly { route: string; actions: readonly string[] }[],
  table: Readonly<Record<string, { door: string } | { not: string }>>,
  reads: readonly string[],
): string[] {
  const at = "packages/server/src/mcp/parity.ts";
  const found: string[] = [];
  const declared = new Set(routes.map((each) => each.route));
  for (const { route, actions: dispatched } of routes) {
    const listed = Object.hasOwn(table, route);
    const read = reads.includes(route);
    if (listed && read) found.push(`${at}: ${route} is one of the window's reads already`);
    if (listed || read || dispatched.length === 1) continue;
    found.push(
      `packages/server/src/api.ts: ${route} has no way in for a program and no reason why not; add a read to packages/server/src/mcp/reads.ts or a line to ${at} (decision 0058)`,
    );
  }
  for (const [route, way] of Object.entries(table)) {
    if (!declared.has(route)) found.push(`${at}: lists ${route}, which no route declares`);
    const said = "door" in way ? way.door : way.not;
    if (said.trim() === "") found.push(`${at}: ${route} says nothing`);
  }
  for (const route of new Set(reads))
    if (!declared.has(route))
      found.push(`packages/server/src/mcp/reads.ts: reads ${route}, which no route declares`);
  return found;
}

// What an action's declaration leaves unsaid: why a door is closed to it, why
// it or part of its input is a person's, or why a direct one has no inverse;
// or an inverse that names no action, or a draftable one the agent could
// call or that is a person's. The agent's functions are generated
// from the same declarations, so none can be missing.
export function actionProblems(declared: Record<string, ActionDeclaration>): string[] {
  const at = "packages/core/src/actions.ts";
  const found: string[] = [];
  const blank = (why: string | undefined) => why === undefined || why.trim() === "";
  for (const [name, action] of Object.entries(declared)) {
    for (const [door, why] of Object.entries(action.closed ?? {}))
      if (blank(why))
        found.push(`${at}: ${name} is closed to the ${door} without a reason (decision 0024)`);
    const { class: kind } = action;
    if (kind.kind === "person-only" && blank(kind.why))
      found.push(`${at}: ${name} is a person's without a reason (decision 0024)`);
    if (kind.kind === "direct" && kind.inverse === null && blank(kind.why))
      found.push(`${at}: ${name} has no inverse and doesn't say why (decision 0024)`);
    if (kind.inverse != null && !Object.hasOwn(declared, kind.inverse))
      found.push(`${at}: ${name}'s inverse ${kind.inverse} isn't an action (decision 0024)`);
    // A draft is for what the agent can't do itself, and never for a
    // person's, such as what holds credentials (decision 0051).
    if (action.draftable && (kind.kind !== "direct" || action.closed?.agent === undefined))
      found.push(
        `${at}: ${name} is draftable, so it must be direct and closed to the agent (decision 0051)`,
      );
    for (const [part, why] of Object.entries(action.userOnly ?? {}))
      if (blank(why))
        found.push(`${at}: ${name}'s ${part} is the user's without a reason (decision 0024)`);
  }
  return found;
}

// Decisions in docs/decisions/ that share a number, as two drafted at once
// can. `pnpm -s github next-decision` gives the next free one.
export function decisionClashes(names: readonly string[]): string[] {
  const byNumber = Map.groupBy(
    names.filter((name) => /^\d{4}-/.test(name)),
    (name) => name.slice(0, 4),
  );
  return [...byNumber]
    .filter(([, same]) => same.length > 1)
    .map(
      ([number, same]) =>
        `docs/decisions: ${same.join(" and ")} share the number ${number}; renumber the newer one with \`pnpm -s github next-decision\``,
    );
}

// Chrome launches without the installed Chrome or its sandbox. Playwright
// passes `--no-sandbox` unless told `chromiumSandbox: true`, and its bundled
// Chromium isn't kept up to date; a script renders agent-written HTML and
// synced content in it. A call's options are read to its closing paren.
export function chromeLaunchProblems(path: string, text: string): string[] {
  const found: string[] = [];
  const why = "it renders agent-written HTML and synced content";
  for (const call of text.matchAll(/\bchromium\.launch\w*\(/g)) {
    let depth = 0;
    let end = call.index + call[0].length - 1;
    do {
      const c = text[end++];
      if (c === "(") depth++;
      if (c === ")") depth--;
    } while (depth > 0 && end < text.length);
    const options = text.slice(call.index, end);
    if (!/\bchannel: "chrome"/.test(options))
      found.push(
        `${path}: launches Chrome without channel: "chrome"; ${why}, so it runs in the installed, updated Chrome`,
      );
    if (!/\bchromiumSandbox: true\b/.test(options))
      found.push(
        `${path}: launches Chrome without chromiumSandbox: true; ${why}, so it keeps Chrome's sandbox`,
      );
  }
  if (text.includes("--no-sandbox"))
    found.push(`${path}: passes --no-sandbox; ${why}, so it keeps Chrome's sandbox`);
  return found;
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
  const routed = new Set<string>();
  for (const { path, text } of repo.sources) {
    if (path.startsWith("packages/server/src/") && !testFile.test(path))
      for (const route of postRoutes(text)) {
        routed.add(route.path);
        if (route.dispatches && route.path in exemptRoutes)
          found.add(
            `scripts/check-repo.ts: POST ${route.path} calls the dispatcher now; take it off the exempt routes`,
          );
        if (!route.dispatches && !(route.path in exemptRoutes))
          found.add(
            `${path}: POST ${route.path} changes state without calling the dispatcher (decision 0024)`,
          );
      }
    for (const problem of chromeLaunchProblems(path, text)) found.add(problem);
    for (const problem of webSourceNames(path, text)) found.add(problem);
    const changeset = path.startsWith("packages/changeset/");
    const core = path.startsWith("packages/core/");
    const ownWriter = ownWriterFile.test(path);
    if (!changeset && !core && /\bApproved\b/.test(text)) {
      found.add(
        `${path}: names Approved outside packages/core and packages/changeset (decision 0003)`,
      );
    }
    if (!changeset && !core && !ownWriter && /\bSourceWriter\b/.test(text)) {
      found.add(
        `${path}: names SourceWriter outside packages/core, packages/changeset and an adapter's writer (decision 0003)`,
      );
    }
    if (path !== writersFile && !ownWriter && writerImport.test(text)) {
      found.add(`${path}: imports a source writer outside ${writersFile} (decision 0003)`);
    }
    if (!path.startsWith("packages/")) continue;
    for (const { kind, writer } of importedAdapters(path, text)) {
      if (mayImportAdapter(path, kind, writer)) continue;
      found.add(
        writer
          ? `${path}: imports the ${kind} writer; only ${writersFile} builds writers (decisions 0003 and 0019)`
          : `${path}: imports the ${kind} adapter; outside packages/${kind}, packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)`,
      );
    }
    if (importsSourceList(text) && !mayImportAdapter(path, "sources", false))
      found.add(
        `${path}: imports @oriel/sources, which reaches every adapter; outside packages/server, packages/evals and tests, take its declarations from the composition root (decision 0019)`,
      );
    for (const other of crossPackageImports(path, text))
      found.add(
        `${path}: imports packages/${other} by a relative path; packages reach each other only through @oriel/${other} and its exports`,
      );
  }
  // Every exemption names a route.
  if (routed.size > 0)
    for (const listed of Object.keys(exemptRoutes))
      if (!routed.has(listed))
        found.add(`scripts/check-repo.ts: lists POST ${listed}, which no route declares`);
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
  // The scan below skips the desktop app's build, which is gitignored; a
  // file committed there anyway would escape it.
  const builtTracked = execFileSync("git", ["ls-files", "packages/desktop/build"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((path) => `${path}: is under packages/desktop/build/, the desktop app's gitignored build`);
  const found = [
    ...builtTracked,
    ...actionProblems(actions),
    ...parityProblems(
      routesOf(readFileSync("packages/server/src/api.ts", "utf8")),
      windowRoutes,
      windowReads.map((read) => read.route),
    ),
    ...themeProblems(readFileSync("packages/web/assets/window.css", "utf8")),
    ...decisionClashes(readdirSync("docs/decisions").filter((f) => f.endsWith(".md"))),
    ...problems({
      claudeLink: readLink("CLAUDE.md"),
      lockfile: readFileSync("pnpm-lock.yaml", "utf8"),
      agentsMd: readFileSync("AGENTS.md", "utf8"),
      decisions: readdirSync("docs/decisions")
        .filter((f) => f.endsWith(".md"))
        .map((f) => readFileSync(`docs/decisions/${f}`, "utf8")),
      // This check and its test spell out what they catch, so neither is scanned.
      sources: ["packages", "scripts"]
        .flatMap((dir) =>
          readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => `${dir}/${f}`),
        )
        .filter((f) => /\.tsx?$/.test(f) && !f.split("/").includes("node_modules"))
        // The desktop app's gitignored build, which holds a copy of the server.
        .filter((f) => !f.startsWith("packages/desktop/build/"))
        .filter((f) => !/^scripts\/check-repo(\.test)?\.ts$/.test(f))
        .map((path) => ({ path, text: readFileSync(path, "utf8") })),
    }),
  ];
  for (const p of found) console.error(p);
  process.exitCode = found.length ? 1 : 0;
}
