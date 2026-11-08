// How the window offers Google Sheets, and names what a connection reads
// (decisions 0049 and 0050). Sheets turns on through sheets-mcp in the
// person's agent (decision 0059), so nothing here signs in to Google: a
// person picks the spreadsheets through the server, and the review step
// drafts how to read them (decision 0051).
import type { ConnectOffer } from "@oriel/core";
import { picksOf } from "./open-connection.ts";

export const sheetsOffer: ConnectOffer = {
  firstRun: 3,
  mark: "S",
  title: "Google Sheets",
  about: "Trackers, RAID logs and plans you pick",
  counts: "row",
  empty: "The picked spreadsheets have no rows Oriel reads yet.",
  yours: "your spreadsheets",
  changes: "Google Sheets",
  follow: "a row",
  ready: "Google Sheets is ready.",
  catchUp: "Google Sheets can catch up later.",
};

// What a connection reads: how many spreadsheets.
export const sheetsReads = ({
  options,
}: {
  options: Readonly<Record<string, unknown>>;
}): string => {
  const count = picksOf(options).spreadsheets.length;
  return `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}`;
};
