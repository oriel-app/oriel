// A case's world: its sources as the case finds them, its region, and how a
// run reads them. Jira is the SYN fixture after the case's source edits. The
// folder is the folder fixture, built in a temporary directory after its own
// edits and read by the real folder source. Both are connected whatever the
// region holds, so search() reaches every indexed item, as in a workspace
// with both sources. Slack is the Slack fixture's picked channel, read by the
// real Slack source through the fixture's Web API, and is connected only for
// a case whose region holds messages, so cases recorded before Slack was a
// source see the index they were recorded with.
//
// Everything the agent can see must be the same on every run and every disk,
// or cassettes won't replay: so the folder has a fixed ID, its files a fixed
// location instead of the temporary path, and the files whose presence
// depends on the disk (case and normalization twins) are left out of the
// index, and no case may hold them.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Namespaces } from "@oriel/bindings";
import {
  type GroupMember,
  type ItemId,
  itemId,
  parseItemId,
  type Reader,
  type ReadResult,
  type Region,
  type SearchHit,
  type Ulid,
  ulid,
} from "@oriel/core";
import { canonicalPath, folderKey, folderSource, resolveFolder } from "@oriel/folder";
import { type FixtureRegion, fixtureSnapshot, jiraNamespace, type JiraFixture } from "@oriel/jira";
import { fixtureApi, type SlackFixture, type SlackRecord, slackSource } from "@oriel/slack";
import {
  buildFolder,
  diskDependent,
  type FolderFixture,
} from "../../../scripts/fixtures/folder.ts";

// Item URLs point here, as they do in the index.
export const evalSite = "https://oriel.atlassian.net";
// The connected folder's ID, as the workspace would have given it when the
// user picked it. Every file's ID hashes it.
export const evalFolderId: Ulid = ulid(Date.UTC(2026, 8, 1), new Uint8Array(10).fill(0xf0));
// Where the folder's files say they are: not the temporary directory, which
// differs on every run.
export const evalFolderLocation = "file:///eval/folder/";

const fixedId: Ulid = ulid(0, new Uint8Array(10));

// A file's item ID, from its path in the folder fixture.
export const fileId = (path: string): ItemId<"folder"> =>
  itemId("folder", folderKey(evalFolderId, canonicalPath(path.split("/"))));

export type WorldInput = {
  fixture: JiraFixture;
  // Null: no folder is connected, and the region holds no files.
  folder: FolderFixture | null;
  // The Jira fixture region the region holds, if any.
  region: FixtureRegion | null;
  // Files from the folder fixture, by path, that the region also holds.
  files: readonly string[];
  // Messages from the Slack fixture, by item ID, that the region also holds,
  // and the fixture they come from.
  messages?: readonly ItemId<"slack">[];
  slack?: SlackFixture;
  // How many of each fixture's edits are applied.
  edited: number;
  folderEdited: number;
};

export type World = {
  // Version 1 of a group holding the Jira region's items, then the files,
  // then the messages.
  region: Region;
  reader: Reader;
  namespaces: Namespaces;
  // Each region item as its source holds it, for the judge: a file with its
  // path and title, and anything gone saying so.
  evidence(): Promise<unknown[]>;
  // Removes the folder's temporary directory.
  close(): void;
};

export async function buildWorld(input: WorldInput): Promise<World> {
  if (input.files.length && !input.folder) throw new Error("the region holds files, but no folder");
  const snapshot = fixtureSnapshot(input.fixture, evalSite, input.edited);
  const stableIds = new Map(input.fixture.issues.map((i) => [`jira:${i.key}`, i.id]));
  const files = input.files.map((path) => ({ id: fileId(path), path }));
  const paths = new Map<string, string>(files.map(({ id, path }) => [id, path]));
  const members: GroupMember[] = [
    ...(input.region?.items ?? []).map((id) => ({ id, stableId: stableIds.get(id) ?? "" })),
    ...files.map(({ id }) => ({ id, stableId: parseItemId(id)?.key ?? "" })),
    ...(input.messages ?? []).map((id) => ({ id, stableId: parseItemId(id)?.key ?? "" })),
  ];
  const region: Region = {
    groupId: fixedId,
    version: 1,
    workspaceId: fixedId,
    items: members,
    origin: input.region?.origin ?? { kind: "picked" },
  };
  const namespaces: Namespaces = {
    jira: jiraNamespace(new Map(snapshot.records.map((r) => [r.id, r.facets.kind]))),
  };

  const folder = input.folder ? await connect(input.folder, input.folderEdited) : null;
  if (input.messages?.length && !input.slack)
    throw new Error("the region holds messages, but no Slack fixture");
  const slack = input.messages?.length && input.slack ? await connectSlack(input.slack) : null;
  const index: SearchHit[] = [
    ...snapshot.records,
    ...(folder?.index ?? []),
    ...(slack?.index ?? []),
  ].map((r) => ({
    id: r.id,
    title: r.title,
    location: r.location,
    updatedAt: r.updatedAt,
  }));

  const reader: Reader = {
    async read(ids) {
      const files = ids.filter(
        (id): id is ItemId<"folder"> => parseItemId(id)?.source === "folder",
      );
      const messages = ids.filter(
        (id): id is ItemId<"slack"> => parseItemId(id)?.source === "slack",
      );
      const read = [
        ...(folder && files.length ? await folder.source.read(files) : []),
        ...(slack && messages.length ? await slack.source.read(messages) : []),
      ];
      const byId = new Map<string, ReadResult>(read.map((r) => [r.id, r]));
      const gone = (id: ItemId): ReadResult => ({ id, status: "gone", reason: "deleted" });
      return ids.map((id): ReadResult => {
        if (parseItemId(id)?.source !== "jira") return byId.get(id) ?? gone(id);
        const content = snapshot.content.get(id as ItemId<"jira">);
        return content ? { id, status: "ok", content } : gone(id);
      });
    },
    // Every term must appear in the item's ID or title.
    async search(query, limit) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return index
        .filter((hit) =>
          terms.every((term) => `${hit.id} ${hit.title}`.toLowerCase().includes(term)),
        )
        .slice(0, limit);
    },
  };

  return {
    region,
    reader,
    namespaces,
    async evidence() {
      const results = await reader.read(members.map((m) => m.id));
      return results.map((result) => {
        const path = paths.get(result.id);
        // A file read gives its title; a gone one has only the path it had.
        const named = path === undefined ? {} : { path };
        if (result.status === "ok") return { id: result.id, ...named, ...result.content };
        if (result.status === "gone" && result.reason === "deleted")
          return { id: result.id, ...named, deleted: true };
        return {
          id: result.id,
          ...named,
          gone: result.status === "moved" ? "moved" : result.reason,
        };
      });
    },
    close: () => folder?.close(),
  };
}

// The folder fixture, built and synced: the source a run reads through, and
// the index records search() finds, relocated and without the disk's twins.
async function connect(fixture: FolderFixture, edited: number) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oriel-evals-folder-")));
  const close = () => rmSync(dir, { recursive: true, force: true });
  try {
    const built = buildFolder(fixture, dir, edited);
    const source = folderSource({
      folderId: evalFolderId,
      path: await resolveFolder(built.root),
      // What the source skipped is the fixture's business, not the agent's.
      log: () => {},
    });
    const twins = new Set([...diskDependent(fixture)].map(fileId));
    const prefix = pathToFileURL(`${built.root}/`).href;
    const index = [];
    for await (const page of source.sync(null)) {
      for (const record of page.records) {
        if (twins.has(record.id)) continue;
        if (!record.location.startsWith(prefix))
          throw new Error(`a file outside the fixture's folder: ${record.location}`);
        index.push({
          ...record,
          location: `${evalFolderLocation}${record.location.slice(prefix.length)}`,
        });
      }
    }
    return { source, index, close };
  } catch (error) {
    close();
    throw error;
  }
}

// The Slack fixture's picked channel, synced: the source a run reads through,
// and the index records search() finds.
async function connectSlack(fixture: SlackFixture) {
  const source = slackSource({
    api: fixtureApi(fixture).api,
    workspaceUrl: fixture.team.url,
    channels: fixture.picked,
    log: () => {},
  });
  const index: SlackRecord[] = [];
  for await (const page of source.sync(null)) index.push(...page.records);
  return { source, index };
}
