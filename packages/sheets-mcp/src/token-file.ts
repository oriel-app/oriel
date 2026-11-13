import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { GoogleClient } from "./oauth.ts";

export const folderName = "oriel-sheets-mcp";

export function configFolder(env: Readonly<Record<string, string | undefined>>, home: string) {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  // The XDG spec asks for an absolute path, and says to ignore any other.
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), folderName);
}

type Kept<T> = {
  path: string;
  read(): T | null;
  write(value: T): void;
  remove(): boolean;
};

function kept<T>(
  folder: string,
  name: string,
  of: (json: unknown) => T | null,
  to: (value: T) => unknown,
): Kept<T> {
  const path = join(folder, name);
  return {
    path,
    read() {
      try {
        if (!lstatSync(path).isFile()) return null;
        return of(JSON.parse(readFileSync(path, "utf8")) as unknown);
      } catch {
        return null;
      }
    },
    write(value) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      // A folder made before, or by someone else's umask, is closed too.
      chmodSync(folder, 0o700);
      // Written whole beside it, then moved over it, so a reader never sees
      // half a file; `wx` never follows a link left at the temporary name.
      const temporary = join(folder, `${name}.${process.pid}.tmp`);
      rmSync(temporary, { force: true });
      writeFileSync(temporary, `${JSON.stringify(to(value))}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    },
    remove() {
      try {
        lstatSync(path);
      } catch {
        return false;
      }
      rmSync(path, { force: true });
      return true;
    },
  };
}

const field = (json: unknown, name: string): unknown =>
  typeof json === "object" && json !== null ? (json as Record<string, unknown>)[name] : undefined;
const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

export type TokenFile = Kept<string>;

export const tokenFile = (folder: string): TokenFile =>
  kept(
    folder,
    "token.json",
    (json) => {
      const token = field(json, "refresh_token");
      return filled(token) ? token : null;
    },
    (token) => ({ refresh_token: token }),
  );

export type ClientFile = Kept<GoogleClient>;

export const clientFile = (folder: string): ClientFile =>
  kept(
    folder,
    "client.json",
    (json) => {
      const id = field(json, "client_id");
      const secret = field(json, "client_secret");
      if (!filled(id) || (secret !== undefined && !filled(secret))) return null;
      return { id, secret: secret ?? null };
    },
    (client) => ({
      client_id: client.id,
      ...(client.secret === null ? {} : { client_secret: client.secret }),
    }),
  );
