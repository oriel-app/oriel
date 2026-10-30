// The package entry. It doesn't export `changeSetsOver` or `buildWriters`:
// change sets build their own writers from config, and nothing outside this
// package can hand them one (decision 0003).
export {
  type ChangeSetDeps,
  ChangeSetError,
  type ChangeSetErrorCode,
  changeSets,
  explainConflicts,
  plainError,
  type FieldReader,
  sendLeaseMs,
  type Specs,
} from "./change-sets.ts";
export type { WriterConfig } from "./writers.ts";
