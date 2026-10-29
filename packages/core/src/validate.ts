// The in-house validator for untrusted input at the boundary: source
// responses, sandbox messages, request bodies, eval cases. Types are inferred
// from validators, so each shape is written once.

export type Issue = { path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Result<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

const pass = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (path: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ path, message }],
});

export const unknown: Validator<unknown> = (input) => pass(input);

export const string: Validator<string> = (input, path = "$") =>
  typeof input === "string" ? pass(input) : fail(path, "expected a string");

export const number: Validator<number> = (input, path = "$") =>
  typeof input === "number" && Number.isFinite(input)
    ? pass(input)
    : fail(path, "expected a finite number");

export const boolean: Validator<boolean> = (input, path = "$") =>
  typeof input === "boolean" ? pass(input) : fail(path, "expected a boolean");

export function literal<const L extends string | number | boolean | null>(
  expected: L,
): Validator<L> {
  return (input, path = "$") =>
    input === expected ? pass(expected) : fail(path, `expected ${JSON.stringify(expected)}`);
}

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (input, path) => (input === undefined ? pass(undefined) : inner(input, path));
}

export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (input, path) => (input === null ? pass(null) : inner(input, path));
}

export function array<T>(item: Validator<T>): Validator<T[]> {
  return (input, path = "$") => {
    if (!Array.isArray(input)) return fail(path, "expected an array");
    const value: T[] = [];
    const issues: Issue[] = [];
    input.forEach((element, i) => {
      const result = item(element, `${path}[${i}]`);
      if (result.ok) value.push(result.value);
      else issues.push(...result.issues);
    });
    return issues.length ? { ok: false, issues } : pass(value);
  };
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// Returns a fresh object holding only the shape's keys; unknown keys are dropped.
export function object<S extends Record<string, Validator<unknown>>>(
  shape: S,
): Validator<{ [K in keyof S]: Infer<S[K]> }> {
  return (input, path = "$") => {
    if (!isPlainObject(input)) return fail(path, "expected an object");
    const value: Record<string, unknown> = {};
    const issues: Issue[] = [];
    for (const [key, validate] of Object.entries(shape)) {
      const result = validate(Object.hasOwn(input, key) ? input[key] : undefined, `${path}.${key}`);
      if (result.ok) value[key] = result.value;
      else issues.push(...result.issues);
    }
    return issues.length ? { ok: false, issues } : pass(value as { [K in keyof S]: Infer<S[K]> });
  };
}

// For keys only known at run time, such as discovered field IDs. Built with
// `Object.fromEntries`, so a "__proto__" key stays an ordinary property.
export function record<T>(value: Validator<T>): Validator<Record<string, T>> {
  return (input, path = "$") => {
    if (!isPlainObject(input)) return fail(path, "expected an object");
    const entries: [string, T][] = [];
    const issues: Issue[] = [];
    for (const [key, element] of Object.entries(input)) {
      const result = value(element, `${path}[${JSON.stringify(key)}]`);
      if (result.ok) entries.push([key, result.value]);
      else issues.push(...result.issues);
    }
    return issues.length ? { ok: false, issues } : pass(Object.fromEntries(entries));
  };
}

// The first alternative that passes wins; on failure, every alternative's issues are reported.
export function union<const V extends readonly Validator<unknown>[]>(
  ...alternatives: V
): Validator<Infer<V[number]>> {
  return (input, path = "$") => {
    const issues: Issue[] = [];
    for (const alternative of alternatives) {
      const result = alternative(input, path);
      if (result.ok) return result as Result<Infer<V[number]>>;
      issues.push(...result.issues);
    }
    return { ok: false, issues };
  };
}

// Narrows with a check; a type guard also narrows the type (e.g. string to Instant).
export function refine<T, U extends T>(
  inner: Validator<T>,
  check: (value: T) => value is U,
  message: string,
): Validator<U>;
export function refine<T>(
  inner: Validator<T>,
  check: (value: T) => boolean,
  message: string,
): Validator<T>;
export function refine<T>(
  inner: Validator<T>,
  check: (value: T) => boolean,
  message: string,
): Validator<T> {
  return (input, path = "$") => {
    const result = inner(input, path);
    if (!result.ok) return result;
    return check(result.value) ? result : fail(path, message);
  };
}

// For recursive shapes.
export function lazy<T>(get: () => Validator<T>): Validator<T> {
  return (input, path) => get()(input, path);
}
