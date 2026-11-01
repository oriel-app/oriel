// SPIKE (OA-74): what a validator's shape says, as the two other things an
// action's input must give: TypeScript type text for the agent's `.d.ts`, and
// JSON Schema for an MCP tool's `inputSchema`.
import type { Shape } from "./validate.ts";

export function typeText(shape: Shape): string {
  switch (shape.kind) {
    case "unknown":
    case "string":
    case "number":
    case "boolean":
      return shape.kind;
    case "literal":
      return JSON.stringify(shape.value);
    case "optional":
      return `${typeText(shape.inner)} | undefined`;
    case "nullable":
      return `${typeText(shape.inner)} | null`;
    case "array": {
      const item = typeText(shape.item);
      return /[ |]/.test(item) ? `(${item})[]` : `${item}[]`;
    }
    case "object":
      return `{ ${Object.entries(shape.fields)
        .map(([key, field]) =>
          field.kind === "optional"
            ? `${key}?: ${typeText(field.inner)}`
            : `${key}: ${typeText(field)}`,
        )
        .join("; ")} }`;
    case "record":
      return `Record<string, ${typeText(shape.value)}>`;
    case "union":
      return shape.alternatives.map(typeText).join(" | ");
    case "refined":
      return shape.type ?? typeText(shape.inner);
  }
}

export function jsonSchema(shape: Shape): Record<string, unknown> {
  switch (shape.kind) {
    case "unknown":
      return {};
    case "string":
    case "number":
    case "boolean":
      return { type: shape.kind };
    case "literal":
      return { const: shape.value };
    case "optional":
      return jsonSchema(shape.inner);
    case "nullable":
      return { anyOf: [jsonSchema(shape.inner), { type: "null" }] };
    case "array":
      return { type: "array", items: jsonSchema(shape.item) };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(shape.fields).map(([key, field]) => [key, jsonSchema(field)]),
        ),
        required: Object.entries(shape.fields)
          .filter(([, field]) => field.kind !== "optional")
          .map(([key]) => key),
        additionalProperties: false,
      };
    case "record":
      return { type: "object", additionalProperties: jsonSchema(shape.value) };
    case "union":
      return { anyOf: shape.alternatives.map(jsonSchema) };
    case "refined":
      return { ...jsonSchema(shape.inner), description: shape.doc, ...shape.json };
  }
}
