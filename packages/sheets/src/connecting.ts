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

export const sheetsReads = ({
  options,
}: {
  options: Readonly<Record<string, unknown>>;
}): string => {
  const count = picksOf(options).spreadsheets.length;
  return `${count} ${count === 1 ? "spreadsheet" : "spreadsheets"}`;
};
