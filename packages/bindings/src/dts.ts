// The region's declarations: what the agent codes against, and what reaches
// its prompt. IDs and types only, never source text. The same scope gives the
// same bytes, since a hash of the output goes in the run record.
import { idUnion } from "@oriel/core";
import { type Scope, spaceNames } from "./describe.ts";
import type { Fn } from "./fn.ts";
import { itemTypes } from "./items.ts";

const header = [
  "// This region's module. Your script is the body of an async function: await",
  "// reads, and return a JSON value for the transcript. Writes are captured into",
  "// a change set for the user to review; nothing is written until they approve.",
  "",
];

const footer = [
  "/** Lines for the transcript. */",
  "declare const console: {",
  "  log(...values: unknown[]): void;",
  "  info(...values: unknown[]): void;",
  "  warn(...values: unknown[]): void;",
  "  error(...values: unknown[]): void;",
  "  debug(...values: unknown[]): void;",
  "};",
];

function signature(fn: Fn): string {
  const params = fn.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
  if (fn.kind === "read") return `${fn.name}(${params}): Promise<${fn.returns}>`;
  return `${fn.name}(${params}): ${fn.creates ? "NewRef" : "void"}`;
}

function namespace(name: string, fns: readonly Fn[]): string[] {
  const members = fns.filter((fn) => fn.space === name);
  if (!members.length) return [];
  return [
    `declare const ${name}: {`,
    ...members.flatMap((fn) => [`  /** ${fn.doc} */`, `  ${signature(fn)};`]),
    "};",
  ];
}

export function declarations(scope: Scope, fns: readonly Fn[]): string {
  return [
    ...header,
    "/** The items in this region. */",
    ...idUnion("RegionId", scope.ids),
    ...itemTypes,
    ...scope.sources.flatMap(({ spec, scope: own }) => spec.types(own)),
    "",
    ...spaceNames.flatMap((name) => namespace(name, fns)),
    ...fns
      .filter((fn) => fn.space === null)
      .flatMap((fn) => [`/** ${fn.doc} */`, `declare function ${signature(fn)};`]),
    ...footer,
    "",
  ].join("\n");
}
