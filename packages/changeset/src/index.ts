// It exports neither `changeSetsOver` nor `buildWriters`: nothing outside this package can hand change sets a writer.
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
