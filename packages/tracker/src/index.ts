// Oriel's own small issue tracker, the stand-in for one (decision 0059): on
// while no other tracker is connected, its issues kept in Oriel's database.
export { trackerDeclaration } from "./declaration.ts";
export { trackerDeclaredFixture } from "./declared-fixture.ts";
export { trackerEdit, trackerEditor } from "./edit.ts";
export {
  idOf,
  type Issue,
  issueOf,
  issuesIn,
  isTrackerId,
  recordOf,
  statuses,
  trackerContent,
  trackerKeyShape,
  trackerPresentation,
} from "./issues.ts";
export { openTracker, type TrackerOn, type TrackerWrites } from "./open-connection.ts";
export { trackerSource } from "./source.ts";
export { tracker, trackerItemDoc, trackerOps } from "./shape.ts";
