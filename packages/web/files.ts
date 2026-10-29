// What the server serves for the web app. This file runs in Node, not in the
// browser; it lives here so specifiers resolve against this package's
// dependencies.

// Compiled modules (`pnpm --filter @oriel/web build`) and static assets.
export const dist = new URL("./dist/", import.meta.url);
export const assets = new URL("./assets/", import.meta.url);
export const entry = "main.js";

// Every bare specifier the compiled app imports, including the JSX runtime
// that `tsc` imports for it, and the ES module file each resolves to.
export const vendor: ReadonlyMap<string, URL> = new Map(
  ["preact", "preact/hooks", "preact/jsx-runtime"].map((specifier) => [
    specifier,
    new URL(import.meta.resolve(specifier)),
  ]),
);
