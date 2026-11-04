// A local folder of markdown files, read-only (decision 0019). It has no
// writer and no op catalogue.
export {
  type FolderAttrs,
  folderAttrs,
  type FolderContent,
  folderContent,
  folderDetails,
  folderFacets,
  folderPresentation,
  type FolderRecord,
} from "./attrs.ts";
export { folderDeclaration } from "./declaration.ts";
export {
  fixtureFileId,
  fixtureFolderId,
  fixtureFolderLocation,
  folderDeclaredFixture,
} from "./declared-fixture.ts";
export {
  buildFolder,
  type BuiltFolder,
  diskDependent,
  type FixtureFile,
  fileTitle,
  filesAfter,
  type FolderEdit,
  type FolderFixture,
  folderFixtureFile,
  loadFolderFixture,
  parseFolderFixture,
} from "./fixture.ts";
export { openChecked } from "./nofollow.ts";
export { folderProblem, openFolder } from "./open-connection.ts";
export {
  type FolderPrefix,
  type FolderSource,
  type FolderSourceOptions,
  folderSource,
} from "./source.ts";
export {
  canonicalPath,
  canonicalTime,
  folderKey,
  type FolderPath,
  maxDepth,
  maxEntries,
  maxFileBytes,
  maxFiles,
  maxTotalBytes,
  resolveFolder,
} from "./walk.ts";
