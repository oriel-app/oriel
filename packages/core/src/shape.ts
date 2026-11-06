// A validator's shape as TypeScript type text, for the line an Oriel action
// gets in a region's `.d.ts` (decision 0024). A refine that names the type it
// narrows to reads as that type.
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
        .map(([name, field]) => {
          // A key that isn't a name, such as `in-progress`, is quoted.
          const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
          return field.kind === "optional"
            ? `${key}?: ${typeText(field.inner)}`
            : `${key}: ${typeText(field)}`;
        })
        .join("; ")} }`;
    case "record":
      return `Record<string, ${typeText(shape.value)}>`;
    case "union":
      return shape.alternatives.map(typeText).join(" | ");
    case "refined":
      return shape.type ?? typeText(shape.inner);
  }
}

// A JSON Schema value, as MCP's `inputSchema` takes one.
export type JsonSchema = { [key: string]: unknown };

// A validator's shape as JSON Schema (2020-12), for an Oriel action's tool
// at the MCP door (decision 0024): one declaration gives its check, its type,
// its `.d.ts` line and this. A refine's check can't be said in JSON Schema,
// so its message is the schema's description, as it is the type's doc.
export function jsonSchema(shape: Shape): JsonSchema {
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
    case "object": {
      const fields = Object.entries(shape.fields);
      const required = fields.flatMap(([key, field]) => (field.kind === "optional" ? [] : [key]));
      return {
        type: "object",
        properties: Object.fromEntries(fields.map(([key, field]) => [key, jsonSchema(field)])),
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case "record":
      return { type: "object", additionalProperties: jsonSchema(shape.value) };
    case "union":
      return { anyOf: shape.alternatives.map(jsonSchema) };
    case "refined":
      return { ...jsonSchema(shape.inner), description: shape.doc };
  }
}
