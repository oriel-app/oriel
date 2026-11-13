// No message here carries a secret's value.
import { lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isUlid } from "@oriel/core";

export type Secrets = {
  get(name: string): Promise<string | null>;
  set(name: string, secret: string): Promise<void>;
  delete(name: string): Promise<void>;
};

// Retiring deletes only those files, then each folder it emptied; nothing else there is touched.
export type OldSecrets = { retire(): number };

export function oldSecretFiles(root: string): OldSecrets {
  // Only a file is a secret kept before: a folder or a link of that name is
  // something else, and stays.
  const gone = (path: string): boolean => {
    try {
      if (!lstatSync(path).isFile()) return false;
      rmSync(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new Error("Oriel couldn't delete a secret it kept before");
    }
  };
  const isFolder = (at: string): boolean => {
    try {
      return lstatSync(at).isDirectory();
    } catch {
      return false;
    }
  };
  // The folders below `at`, itself a folder and never a link, nor any of
  // them; none when it isn't there.
  const folders = (at: string): string[] => {
    try {
      if (!isFolder(at)) return [];
      return readdirSync(at, { withFileTypes: true })
        .filter((each) => each.isDirectory())
        .map((each) => join(at, each.name));
    } catch {
      return [];
    }
  };
  const secretsIn = (at: string): string[] => {
    try {
      return readdirSync(at, { withFileTypes: true })
        .filter((each) => each.isFile() && each.name.startsWith("connection."))
        .filter((each) => isUlid(each.name.slice("connection.".length)))
        .map((each) => join(at, each.name));
    } catch {
      return [];
    }
  };
  return {
    retire() {
      // The folder itself is never followed through a link either.
      if (!isFolder(root)) return 0;
      const fresh = folders(join(root, "fresh"));
      const databases = [...folders(root), ...fresh.flatMap(folders)];
      const deleted = [
        ...databases.flatMap(secretsIn),
        ...[root, ...fresh].map((at) => join(at, "jira.json")),
      ].filter(gone).length;
      if (deleted > 0)
        for (const at of [...databases, ...fresh])
          try {
            if (readdirSync(at).length === 0) rmdirSync(at);
          } catch {
            // It holds something else: it stays as it is.
          }
      return deleted;
    },
  };
}
