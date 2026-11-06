// The one thing kept on disk: the refresh token `login` brings back, in
// `oriel-sheets-mcp/token.json` under $XDG_CONFIG_HOME, or ~/.config. Only
// its owner may read the folder (0700) or the file (0600). Access tokens
// are never written; the server keeps them in memory.
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

export const folderName = "oriel-sheets-mcp";

export function configFolder(env: Readonly<Record<string, string | undefined>>, home: string) {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  // The spec asks for an absolute path, and says to ignore any other.
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), folderName);
}

export type TokenFile = {
  path: string;
  // The refresh token, or null when there's none, or the file isn't one
  // this wrote.
  read(): string | null;
  write(refreshToken: string): void;
  // Whether there was one to delete.
  remove(): boolean;
};

export function tokenFile(folder: string): TokenFile {
  const path = join(folder, "token.json");
  return {
    path,
    read() {
      try {
        if (!lstatSync(path).isFile()) return null;
        const kept: unknown = JSON.parse(readFileSync(path, "utf8"));
        const token = (kept as { refresh_token?: unknown } | null)?.refresh_token;
        return typeof token === "string" && token !== "" ? token : null;
      } catch {
        return null;
      }
    },
    write(refreshToken) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      // A folder made before, or by someone else's umask, is closed too.
      chmodSync(folder, 0o700);
      // Written whole beside it, then moved over it, so a reader never sees
      // half a file; `wx` never follows a link left at the temporary name.
      const temporary = join(folder, `token.json.${process.pid}.tmp`);
      rmSync(temporary, { force: true });
      writeFileSync(temporary, `${JSON.stringify({ refresh_token: refreshToken })}\n`, {
        mode: 0o600,
        flag: "wx",
      });
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
