// The Google Sheets connector (decisions 0049 and 0050): signing in
// (Google's OAuth for installed apps, with its Picker), reading the picked
// spreadsheets' mapped tabs, and the fixture with its stand-in for Google's
// APIs. Read-only: it has no writer yet.
export {
  type A1Range,
  type Bounds,
  columnIndex,
  columnLetters,
  parseBounds,
  parseCell,
  parseRange,
  quoteTab,
} from "./a1.ts";
export {
  applyChange,
  type FixtureCell,
  type FixtureChange,
  type FixtureComment,
  type FixtureReply,
  type FixtureSpreadsheet,
  type FixtureTab,
  type FixtureValue,
  type FixtureVersion,
  gridOf,
  loadSheetsFixture,
  parseSheetsFixture,
  type SheetsFixture,
  sheetsFixtureDir,
  shown,
  valueOf,
} from "./fixture.ts";
export { type After, type Loopback, loopback, type Redirect, signInMs } from "./loopback.ts";
export {
  authorizeUrl,
  type Fetch,
  type GoogleClient,
  pickedFiles,
  refresh,
  type Refresh,
  scope,
  signIn,
  type SignIn,
  type SignInIo,
  spreadsheetType,
  type Tokens,
} from "./oauth.ts";
export { challengeOf, newState, pkce, type Pkce, type Random } from "./pkce.ts";
export {
  driveOrigin,
  fixtureGoogle,
  sheetsOrigin,
  type StandIn,
  type StandInCall,
  type StandInOptions,
  standInToken,
} from "./stand-in.ts";
export {
  maxItemChars,
  type RowContent,
  rowKey,
  type SheetsAttrs,
  sheetsAttrs,
  sheetsAttrsOf,
  type SheetsContent,
  sheetsContent,
  sheetsItemDoc,
  sheetsKeyShape,
  sheetsPanel,
  sheetsPresentation,
  type SheetsRecord,
  type SpreadsheetContent,
  spreadsheetKey,
} from "./attrs.ts";
export { sheetsDeclaration } from "./declaration.ts";
export { fixtureMappings, fixturePicks, sheetsDeclaredFixture } from "./declared-fixture.ts";
export {
  type DriveFile,
  type Google,
  type GoogleReads,
  googleReads,
  maxBackoffMs,
  maxRetries,
  type SheetComment,
  SheetsError,
  type TabInfo,
} from "./google.ts";
export {
  fieldNames,
  mappingPrint,
  type SheetsPicks,
  sheetsPicks,
  type SpreadsheetPick,
  type States,
  type TabMapping,
  tabMapping,
} from "./mapping.ts";
export { type OpenedSheets, openSheets, picksOf, sheetsProblem } from "./open-connection.ts";
export { sheetsOverview } from "./overview.ts";
export {
  maxRows,
  maxSpreadsheets,
  maxTabs,
  type SheetsReport,
  type SheetsSource,
  type SheetsSourceOptions,
  sheetsSource,
  type TabReport,
} from "./source.ts";
export { type Cell, type Grid, type Table, type TableRow, tableOf } from "./table.ts";
