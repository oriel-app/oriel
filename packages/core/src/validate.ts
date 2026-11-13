export type Issue = { path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Result<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

export type Shape =
  | { kind: "unknown" | "string" | "number" | "boolean" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "optional" | "nullable"; inner: Shape }
  | { kind: "array"; item: Shape }
  | { kind: "object"; fields: Record<string, Shape> }
  | { kind: "record"; value: Shape }
  | { kind: "union"; alternatives: Shape[] }
  | { kind: "refined"; inner: Shape; doc: string; type?: string };
export type Described<T> = Validator<T> & { readonly shape: Shape };

export const shapeOf = (validator: Validator<unknown>): Shape =>
  (validator as Partial<Described<unknown>>).shape ?? { kind: "unknown" };
const described = <T>(validator: Validator<T>, shape: Shape): Described<T> =>
  Object.assign(validator, { shape });

const pass = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (path: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ path, message }],
});

export const unknown = described<unknown>((input) => pass(input), { kind: "unknown" });

export const string = described<string>(
  (input, path = "$") =>
    typeof input === "string" ? pass(input) : fail(path, "expected a string"),
  { kind: "string" },
);

export const number = described<number>(
  (input, path = "$") =>
    typeof input === "number" && Number.isFinite(input)
      ? pass(input)
      : fail(path, "expected a finite number"),
  { kind: "number" },
);

export const boolean = described<boolean>(
  (input, path = "$") =>
    typeof input === "boolean" ? pass(input) : fail(path, "expected a boolean"),
  { kind: "boolean" },
);

export function literal<const L extends string | number | boolean | null>(
  expected: L,
): Described<L> {
  return described<L>(
    (input, path = "$") =>
      input === expected ? pass(expected) : fail(path, `expected ${JSON.stringify(expected)}`),
    { kind: "literal", value: expected },
  );
}

export function optional<T>(inner: Validator<T>): Described<T | undefined> {
  return described<T | undefined>(
    (input, path) => (input === undefined ? pass(undefined) : inner(input, path)),
    { kind: "optional", inner: shapeOf(inner) },
  );
}

export function nullable<T>(inner: Validator<T>): Described<T | null> {
  return described<T | null>((input, path) => (input === null ? pass(null) : inner(input, path)), {
    kind: "nullable",
    inner: shapeOf(inner),
  });
}

export function array<T>(item: Validator<T>): Described<T[]> {
  return described<T[]>(
    (input, path = "$") => {
      if (!Array.isArray(input)) return fail(path, "expected an array");
      const value: T[] = [];
      const issues: Issue[] = [];
      input.forEach((element, i) => {
        const result = item(element, `${path}[${i}]`);
        if (result.ok) value.push(result.value);
        else issues.push(...result.issues);
      });
      return issues.length ? { ok: false, issues } : pass(value);
    },
    { kind: "array", item: shapeOf(item) },
  );
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// Holds only the shape's keys: unknown keys are dropped.
export function object<S extends Record<string, Validator<unknown>>>(
  shape: S,
): Described<{ [K in keyof S]: Infer<S[K]> }> {
  const fields = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, shapeOf(v)]));
  return described<{ [K in keyof S]: Infer<S[K]> }>(
    (input, path = "$") => {
      if (!isPlainObject(input)) return fail(path, "expected an object");
      const value: Record<string, unknown> = {};
      const issues: Issue[] = [];
      for (const [key, validate] of Object.entries(shape)) {
        const result = validate(
          Object.hasOwn(input, key) ? input[key] : undefined,
          `${path}.${key}`,
        );
        if (result.ok) value[key] = result.value;
        else issues.push(...result.issues);
      }
      return issues.length ? { ok: false, issues } : pass(value as { [K in keyof S]: Infer<S[K]> });
    },
    { kind: "object", fields },
  );
}

// Built with `Object.fromEntries`, so a "__proto__" key stays an ordinary property.
export function record<T>(value: Validator<T>): Described<Record<string, T>> {
  return described<Record<string, T>>(
    (input, path = "$") => {
      if (!isPlainObject(input)) return fail(path, "expected an object");
      const entries: [string, T][] = [];
      const issues: Issue[] = [];
      for (const [key, element] of Object.entries(input)) {
        const result = value(element, `${path}[${JSON.stringify(key)}]`);
        if (result.ok) entries.push([key, result.value]);
        else issues.push(...result.issues);
      }
      return issues.length ? { ok: false, issues } : pass(Object.fromEntries(entries));
    },
    { kind: "record", value: shapeOf(value) },
  );
}

export function union<const V extends readonly Validator<unknown>[]>(
  ...alternatives: V
): Described<Infer<V[number]>> {
  const shapes = alternatives.map(shapeOf);
  const literals = shapes.map((shape) =>
    shape.kind === "object"
      ? new Map(
          Object.entries(shape.fields).flatMap(([key, field]) =>
            field.kind === "literal" ? [[key, field.value] as const] : [],
          ),
        )
      : new Map(),
  );
  const tags = [...(literals[0]?.keys() ?? [])].filter((key) =>
    literals.every((fields) => fields.has(key)),
  );
  const tagged = (input: unknown, i: number) =>
    tags.length > 0 &&
    isPlainObject(input) &&
    tags.every((key) => Object.hasOwn(input, key) && input[key] === literals[i]?.get(key));
  return described<Infer<V[number]>>(
    (input, path = "$") => {
      const all: Issue[] = [];
      const ofTagged: Issue[] = [];
      for (const [i, alternative] of alternatives.entries()) {
        const result = alternative(input, path);
        if (result.ok) return result as Result<Infer<V[number]>>;
        all.push(...result.issues);
        if (tagged(input, i)) ofTagged.push(...result.issues);
      }
      return { ok: false, issues: ofTagged.length > 0 ? ofTagged : all };
    },
    { kind: "union", alternatives: shapes },
  );
}

type Says = { type?: string };
export function refine<T, U extends T>(
  inner: Validator<T>,
  check: (value: T) => value is U,
  message: string,
  says?: Says,
): Described<U>;
export function refine<T>(
  inner: Validator<T>,
  check: (value: T) => boolean,
  message: string,
  says?: Says,
): Described<T>;
export function refine<T>(
  inner: Validator<T>,
  check: (value: T) => boolean,
  message: string,
  says: Says = {},
): Described<T> {
  return described<T>(
    (input, path = "$") => {
      const result = inner(input, path);
      if (!result.ok) return result;
      return check(result.value) ? result : fail(path, message);
    },
    { kind: "refined", inner: shapeOf(inner), doc: message, ...says },
  );
}

export function lazy<T>(get: () => Validator<T>): Described<T> {
  return described<T>((input, path) => get()(input, path), { kind: "unknown" });
}

export const shortText = (max: number, what: string) =>
  refine(
    string,
    (text) => text.trim() !== "" && [...text].length <= max,
    `expected ${what} of 1 to ${max} characters`,
  );
