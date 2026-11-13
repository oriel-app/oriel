// Its ops are named as Jira's are where they mean the same, so the agent's namespace reads the same for both.
import { type Infer, issueShape, type IssueOps } from "@oriel/core";
import { trackerEdit } from "./edit.ts";
import { description, label, personName, points, status, summary } from "./ops.ts";
import {
  type Issue,
  isStatusName,
  isTrackerId,
  statuses,
  statusNames,
  trackerContent,
} from "./issues.ts";

// Shape only, never source text.
export const trackerItemDoc =
  "A tracker item is an issue in Oriel's own tracker, an epic or a story: its title is its summary, its text its summary and description.";

const declared = {
  kind: "tracker",
  name: "Tracker",
  called: "a tracker item",
  source: "the tracker",
  unkept: "the tracker didn't keep",
  from: "Oriel's tracker",
  is: isTrackerId,
  container: {
    word: "epic",
    a: "an epic",
    plural: "epics",
    op: "createEpic",
    title: "summary",
    check: summary,
    made: "an epic",
    in: "",
    keyed: true,
  },
  issue: { word: "story", a: "a story", plural: "stories", op: "createStory", fresh: "story" },
  title: {
    op: "setSummary",
    arg: "summary",
    check: summary,
    doc: "Set an item's summary.",
    label: "Summary",
  },
  description: { check: description, doc: "Replace an item's description, as plain text." },
  estimate: {
    arg: "points",
    check: points,
    doc: "Set a story's estimate in story points; null clears it. An epic takes none.",
    label: "Story points",
  },
  assignee: {
    arg: "name",
    check: personName,
    doc: "Assign an item to a person by the name they go by; null unassigns.",
  },
  status: {
    check: status,
    doc: "Move an item to a status; any may follow any.",
    type: "TrackerStatus",
    declares: [
      `type TrackerStatus = ${statusNames.map((name) => JSON.stringify(name)).join(" | ")};`,
    ],
  },
  label: { check: label, doc: "Add a label, one word, to an item." },
  item: { kinds: ["epic", "story"] },
  view: (content: unknown) => {
    const read = trackerContent(content);
    if (!read.ok) return null;
    const c = read.value;
    return {
      kind: c.kind,
      title: c.summary,
      description: c.description,
      status: c.status,
      container: c.epic,
      assignee: c.assignee,
      estimate: c.points,
      labels: c.labels,
    };
  },
  panel: (content: unknown) => {
    const read = trackerContent(content);
    if (!read.ok || !isStatusName(read.value.status)) return null;
    const { kind, status, assignee, points, labels, description } = read.value;
    const category = statuses.find((each) => each.name === status)?.category ?? "todo";
    const issue: Issue = {
      ...read.value,
      status,
      epic: null,
      updatedAt: read.value.updatedAt as Issue["updatedAt"],
    };
    return {
      facts: {
        type: kind === "epic" ? "Epic" : "Story",
        status: { name: status, category },
        assignee: assignee === null ? null : { id: assignee, name: assignee },
        ...(kind === "story" ? { estimate: points } : {}),
        labels,
      },
      description,
      format: "plain" as const,
      edit: trackerEdit(issue),
    };
  },
  region: (on: boolean) => (on ? { doc: "This region's tracker items." } : undefined),
} as const;

export const tracker = issueShape(declared);

export const trackerOps = tracker.ops;
export type TrackerOps = IssueOps<typeof declared>;
export type TrackerOp = keyof TrackerOps & string;
export type TrackerArgs<O extends TrackerOp> = Infer<TrackerOps[O]["args"]>;
export const trackerSpecs = tracker.specs;
