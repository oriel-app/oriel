// The in-house validator for untrusted input at the boundary: source
// responses, sandbox messages, request bodies, eval cases. Types are inferred
// from validators, so each shape is written once.

export type Issue = { path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Result<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

// What a validator checks, as data, so one declaration of an Oriel action
// gives its check, its type and its `.d.ts` line (decision 0024; shape.ts).
// A hand-written validator has no shape and reads as unknown.
export type Shape =
  | { kind: "unknown" | "string" | "number" | "boolean" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "optional" | "nullable"; inner: Shape }
  | { kind: "array"; item: Shape }
  | { kind: "object"; fields: Record<string, Shape> }
  | { kind: "record"; value: Shape }
  | { kind: "union"; alternatives: Shape[] }
  // A check the shape can't say by itself: its message is its doc, and it
  // may name the type it narrows to.
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

// Returns a fresh object holding only the shape's keys; unknown keys are dropped.
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

// For keys only known at run time, such as discovered field IDs. Built with
// `Object.fromEntries`, so a "__proto__" key stays an ordinary property.
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

// The first alternative that passes wins; on failure, every alternative's issues are reported.
export function union<const V extends readonly Validator<unknown>[]>(
  ...alternatives: V
): Described<Infer<V[number]>> {
  return described<Infer<V[number]>>(
    (input, path = "$") => {
      const issues: Issue[] = [];
      for (const alternative of alternatives) {
        const result = alternative(input, path);
        if (result.ok) return result as Result<Infer<V[number]>>;
        issues.push(...result.issues);
      }
      return { ok: false, issues };
    },
    { kind: "union", alternatives: alternatives.map(shapeOf) },
  );
}

// Narrows with a check; a type guard also narrows the type (e.g. string to Instant).
// The check is a function, so it can't describe itself: `says` names the type
// it narrows to, when that matters.
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

// For recursive shapes. Its shape is unknown: a recursive shape would need
// named references.
export function lazy<T>(get: () => Validator<T>): Described<T> {
  return described<T>((input, path) => get()(input, path), { kind: "unknown" });
}
