// Usage: node scripts/fixtures/folder.ts [--edited <n>]
//   prints the path of a fresh tree, with its first n edits applied.
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
