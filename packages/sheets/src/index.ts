// The Google Sheets connector (decisions 0049 and 0050). For now, signing
// in (Google's OAuth for installed apps, with its Picker), and the fixture
// with its stand-in for Google's APIs.
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
  parseSheetsFixture,
  type SheetsFixture,
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
