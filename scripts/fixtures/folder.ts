// Builds the folder fixture (`fixtures/folder/tree.json`) as a real tree, for
// a person to look at.
//
// Usage: node scripts/fixtures/folder.ts [--edited <n>]
//   builds the tree, with its first n edits applied, in a fresh temporary
//   directory, and prints the folder's path.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildFolder, loadFolderFixture } from "../../packages/folder/src/fixture.ts";

const { values } = parseArgs({ options: { edited: { type: "string", default: "0" } } });
const edited = Number(values.edited);
const dir = mkdtempSync(join(tmpdir(), "oriel-folder-fixture-"));
const built = buildFolder(loadFolderFixture(), dir, edited);
for (const path of built.folded) console.error(`folded by this disk: ${path}`);
console.log(built.root);
