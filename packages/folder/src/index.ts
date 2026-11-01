// A local folder of markdown files, read-only (decision 0019). It has no
// writer and no op catalogue.
export {
  type FolderAttrs,
  folderAttrs,
  type FolderContent,
  folderContent,
  folderDetails,
  folderFacets,
  folderItemDoc,
  folderPresentation,
  type FolderRecord,
} from "./attrs.ts";
export { type FolderSource, type FolderSourceOptions, folderSource } from "./source.ts";
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
