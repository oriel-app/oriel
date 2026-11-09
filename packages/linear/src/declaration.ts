// Linear as it declares itself to the composition root (OA-278): a tracker
// like Jira, on only through Linear's own MCP server (decision 0059).
import {
  issueDeclaredFacets,
  issueOverview,
  itemId,
  object,
  optional,
  type Recognizer,
  refine,
  type SourceDeclaration,
  string,
} from "@oriel/core";
import { linearDeclaredFixture } from "./declared-fixture.ts";
import { linearKeyShape, linearPresentation } from "./items.ts";
import { linearServer } from "./linear-mcp.ts";
import {
  type LinearContext,
  type LinearScope,
  type LinearWrites,
  openLinear,
} from "./open-connection.ts";
import { linear, linearItemDoc } from "./shape.ts";

// Its team's issue identifiers in any text, as ENG-4.
const recognizer =
  ({ team }: LinearScope): Recognizer =>
  (text) =>
    [...new Set(text.match(new RegExp(`\\b${team}-[1-9][0-9]{0,8}\\b`, "g")) ?? [])].map((key) =>
      itemId("linear", key),
    );

export const linearDeclaration = {
  kind: "linear",
  key: linearKeyShape,
  ...linearPresentation,
  itemDoc: linearItemDoc,
  panel: linear.panel,
  recognizer,
  // An issue tracker's, as every tracker's are (decision 0059).
  facets: issueDeclaredFacets,
  overview: issueOverview,
  namespace: (records, context: LinearContext | undefined) => linear.namespace(records, context),
  specs: linear.specs,
  // Its item doc and its namespace, with its team's cycles and team():
  // 2,808 bytes in OA-278.
  budget: 2_850,
  open: openLinear,
  // The team it reads, by its key; the server's first when absent.
  options: object({
    team: optional(
      refine(string, (key) => /^[A-Z][A-Z0-9]{0,9}$/.test(key), "expected a team's key"),
    ),
  }),
  servers: [linearServer],
  takeIssues: linear.takeIssues,
  fixture: linearDeclaredFixture,
} satisfies SourceDeclaration<LinearContext | undefined, LinearScope, LinearWrites>;
