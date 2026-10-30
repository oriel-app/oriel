// A local folder of markdown files, read-only (decision 0019). It has no
// writer and no op catalogue.
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
