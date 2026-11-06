// The stand-in tracker as it declares itself to the composition root: a
// tracker like Jira, on while no other tracker is (decision 0059).
import {
  issueDeclaredFacets,
  issueOverview,
  itemId,
  object,
  type Recognizer,
  type SourceDeclaration,
} from "@oriel/core";
import { trackerDeclaredFixture } from "./declared-fixture.ts";
import { trackerKeyShape, trackerPresentation } from "./issues.ts";
import { trackerItemDoc, trackerNamespace } from "./namespace.ts";
import { openTracker, type TrackerOn, type TrackerWrites } from "./open-connection.ts";
import { trackerPanel } from "./panel.ts";
import { trackerSpecs } from "./specs.ts";

// Its keys in any text, as T-12.
const recognizer: Recognizer = (text) =>
  [...new Set(text.match(/\bT-[1-9][0-9]*\b/g) ?? [])].map((key) => itemId("tracker", key));

export const trackerDeclaration = {
  kind: "tracker",
  key: trackerKeyShape,
  ...trackerPresentation,
  itemDoc: trackerItemDoc,
  panel: trackerPanel,
  recognizer: () => recognizer,
  facets: issueDeclaredFacets,
  overview: issueOverview,
  // Off, it offers the agent nothing.
  namespace: (records, on: TrackerOn | undefined) =>
    trackerNamespace(
      new Map(records.map((record) => [record.id, record.facets.kind])),
      on !== undefined,
    ),
  specs: trackerSpecs,
  // Its item doc and its namespace.
  budget: 2_400,
  open: openTracker,
  options: object({}),
  standIn: {
    for: ["jira"],
    offer: {
      firstRun: 1,
      mark: "T",
      title: "Epics and stories",
      about: "Oriel keeps them for you until you connect a tracker",
      counts: "issue",
      empty: "No epics yet. Ask Oriel to plan something, and approve what it drafts.",
      yours: "your epics and stories",
      changes: "your epics and stories",
      follow: "an epic",
      ready: "Kept on this Mac, in Oriel",
      catchUp: "Kept on this Mac, in Oriel",
    },
  },
  fixture: trackerDeclaredFixture,
} satisfies SourceDeclaration<TrackerOn | undefined, undefined, TrackerWrites>;
