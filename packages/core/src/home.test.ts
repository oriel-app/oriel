import assert from "node:assert/strict";
import { test } from "node:test";
import { homeLocation, homeRelative, homeRelativeIn } from "./home.ts";

// The Mac's user name must never reach the window or the agent: screenshots of the window go to a public repo.
const home = "/Users/pat";

test("a path from home reads from ~; one outside it, or a sibling, stays absolute", () => {
  assert.equal(homeRelative("/Users/pat", home), "~");
  assert.equal(homeRelative("/Users/pat/", home), "~");
  assert.equal(homeRelative("/Users/pat/notes/a b", home), "~/notes/a b");
  assert.equal(homeRelative("/Users/pat/notes", `${home}/`), "~/notes");
  assert.equal(homeRelative("/opt/homebrew/bin/claude", home), "/opt/homebrew/bin/claude");
  assert.equal(homeRelative("/Users/pat2/notes", home), "/Users/pat2/notes");
  assert.equal(homeRelative("/Users/patrick", home), "/Users/patrick");
  assert.equal(homeRelative("/Users/pat/notes", "/"), "/Users/pat/notes");
});

test("a file link under home reads as its path from ~; other locations stay", () => {
  assert.equal(homeLocation("file:///Users/pat/notes/a%20b.md", home), "~/notes/a b.md");
  assert.equal(homeLocation("file:///Users/pat2/a.md", home), "file:///Users/pat2/a.md");
  assert.equal(homeLocation("file:///eval/folder/a.md", home), "file:///eval/folder/a.md");
  assert.equal(homeLocation("https://x.test/Users/pat/a", home), "https://x.test/Users/pat/a");
});

test("in a line of text, only a path that starts at home is shortened", () => {
  assert.equal(
    homeRelativeIn("Running /Users/pat/.local/bin/claude in /Users/pat", home),
    "Running ~/.local/bin/claude in ~",
  );
  assert.equal(
    homeRelativeIn("at /Users/pat2/x and /private/Users/pat/y", home),
    "at /Users/pat2/x and /private/Users/pat/y",
  );
  assert.equal(homeRelativeIn('"/Users/pat/x"', home), '"~/x"');
});
