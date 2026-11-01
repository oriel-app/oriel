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
