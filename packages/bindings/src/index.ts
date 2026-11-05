export { bindingsFor } from "./bindings.ts";
export { type ItemDocs, type Namespaces, orielNames } from "./describe.ts";
export { guestStart, scriptLineOffset } from "./shim.ts";
export { type TscControl, typecheck } from "./typecheck.ts";
export { type Waiting, type WaitingConnection, type WaitingOne, waitingOf } from "./drafts.ts";
// What the MCP door generates its tools from, as the agent's module is
// (decision 0024): the actions' inputs as the agent gives them, and Oriel's
// own reads.
export { agentShapes, notTheUsers } from "./actions.ts";
export { orielFns } from "./oriel.ts";
export type { Host, ReadFn } from "./fn.ts";
