// The folder fixture as the folder's declared fixture (decision 0049):
// `fixtures/folder/`, built in a temporary directory after its edits and read
// by the real folder source. So that it is the same on every run and every
// disk, the folder has a fixed ID, its files a fixed location instead of the
// temporary path, and the files whose presence depends on the disk (case and
// normalization twins) are left out of the index, and no case may hold them.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type IndexRecord,
  type ItemId,
  itemId,
  type LoadedFixture,
  listed,
  type SourceFixture,
  type Ulid,
  ulid,
} from "@oriel/core";
import {
  buildFolder,
  diskDependent,
  fileTitle,
  type FolderFixture,
  loadFolderFixture,
} from "./fixture.ts";
import { folderAttrs } from "./attrs.ts";
import { folderProblem } from "./open-connection.ts";
import { type FolderPrefix, folderSource } from "./source.ts";
import { canonicalPath, folderKey, resolveFolder } from "./walk.ts";

// The folder's ID, as the workspace would have given it when the user picked
// it. Every file's ID hashes it.
export const fixtureFolderId: Ulid = ulid(Date.UTC(2026, 8, 1), new Uint8Array(10).fill(0xf0));
// Where its files say they are: not the temporary directory, which differs
// on every run.
export const fixtureFolderLocation = "file:///eval/folder/";

// A file's item ID, from its path in the fixture.
export const fixtureFileId = (path: string): ItemId<"folder"> =>
  itemId("folder", folderKey(fixtureFolderId, canonicalPath(path.split("/"))));

export const folderDeclaredFixture: SourceFixture = {
  load: () => loaded(loadFolderFixture()),
  everyCase: true,
  connection: () => ({ identity: fixtureFolderLocation, options: {} }),
  // Built in a temporary directory after its edits, which closing removes,
  // and read by the real folder source under the fixture's folder ID.
  open: async (connection, via) => {
    const fixture = loadFolderFixture();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-fixture-folder-")));
    const close = () => rmSync(dir, { recursive: true, force: true });
    try {
      const built = buildFolder(fixture, dir, fixture.edits.length);
      const path = await resolveFolder(built.root);
      return {
        source: folderSource({
          folderId: fixtureFolderId,
          path,
          prefix: connection.prefix as FolderPrefix,
          log: via.log,
        }),
        attrs: folderAttrs,
        about: "the folder fixture",
        scope: undefined,
        context: () => undefined,
        problem: folderProblem,
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  },
};

function loaded(fixture: FolderFixture): LoadedFixture {
  const dependent = diskDependent(fixture);
  // A file before any edit, or the name an edit renames one to.
  const known = [
    ...fixture.files.map((f) => f.path),
    ...fixture.edits.flatMap((e) => (e.kind === "rename" ? [e.to] : [])),
  ];
  const paths = new Map<string, string>(
    known.filter((path) => !dependent.has(path)).map((path) => [fixtureFileId(path), path]),
  );
  return {
    edits: fixture.edits.length,
    firstEdit: null,
    regions: [],
    // A file by its path.
    item: (path) => {
      if (dependent.has(path))
        return {
          problem: `${JSON.stringify(path)} exists or not depending on the disk, so the case wouldn't replay everywhere`,
        };
      return known.includes(path)
        ? { id: fixtureFileId(path) }
        : { problem: `${JSON.stringify(path)} isn't in the folder fixture` };
    },
    // By its title.
    called: (id) => {
      const path = paths.get(id);
      return path === undefined ? null : fileTitle(path);
    },
    chips: () =>
      fixture.files.map((file) => [fixtureFileId(file.path), fileTitle(file.path)] as const),
    // A gone file's read can't give its path.
    about: (id): Record<string, string> => {
      const path = paths.get(id);
      return path === undefined ? {} : { path };
    },
    connect: (edited) => connect(fixture, edited),
  };
}

// The fixture, built and synced: the source a run reads through, and the
// index, relocated and without the disk's twins.
async function connect(fixture: FolderFixture, edited: number) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-fixture-folder-")));
  const close = () => rmSync(dir, { recursive: true, force: true });
  try {
    const built = buildFolder(fixture, dir, edited);
    const source = folderSource({
      folderId: fixtureFolderId,
      path: await resolveFolder(built.root),
      // What the source skipped is the fixture's business, not the agent's.
      log: () => {},
    });
    const twins = new Set([...diskDependent(fixture)].map(fixtureFileId));
    const prefix = pathToFileURL(`${built.root}/`).href;
    const synced = await listed(source.sync(null));
    const records: IndexRecord[] = synced.records.flatMap((record) => {
      if (twins.has(record.id)) return [];
      if (!record.location.startsWith(prefix))
        throw new Error(`a file outside the fixture's folder: ${record.location}`);
      return [
        { ...record, location: `${fixtureFolderLocation}${record.location.slice(prefix.length)}` },
      ];
    });
    return {
      records,
      texts: new Map([...synced.texts].filter(([id]) => !twins.has(id as ItemId<"folder">))),
      read: (ids: readonly ItemId[]) => source.read(ids as ItemId<"folder">[]),
      context: undefined,
      // Its edits aren't logged: no case asks what they changed.
      changes: () => [],
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
