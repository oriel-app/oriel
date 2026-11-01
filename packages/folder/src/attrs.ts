// What the index keeps per file beyond core's fields, what a read returns, and
// how the folder shows in the window. A file has a title, a location and an
// update time, and its one facet is its kind, "doc": directories aren't epics,
// and a file has no people, state or estimate (decision 0019).
import {
  type DetailsOf,
  type Facets,
  type IndexRecord,
  nullable,
  object,
  type Presentation,
  string,
  type Validator,
} from "@oriel/core";

// What a file is, in the declarations' `Item` (see `ItemDocs` in bindings):
// shape only, never source text.
export const folderItemDoc =
  "A folder item is a markdown file: its title is the file's name, its text the file. It has no status, assignee or estimate. Name it by its title.";

// Nothing: core's fields say all the window needs about a file.
export type FolderAttrs = Record<string, never>;

export type FolderRecord = IndexRecord<"folder", FolderAttrs>;

// A file's content, read live.
export type FolderContent = {
  // The file's name without `.md`, in NFC, as the walk found it: data, like
  // the text.
  title: string;
  // The file's text, or for a file too large to read, a note saying so.
  text: string;
  // Oriel's words about how `text` was made, when it isn't simply the file's
  // UTF-8 text: the file was too large, or invalid bytes were replaced. Null
  // otherwise.
  note: string | null;
};

export const folderAttrs: Validator<FolderAttrs> = object({});

// What a read returns, checked where it is used: a reader may sit behind any
// transport.
export const folderContent = object({
  title: string,
  text: string,
  note: nullable(string),
}) satisfies Validator<FolderContent>;

export const folderFacets = (): Facets => ({ kind: "doc" });

// A file has no type or status of its own beyond its kind, so the window shows
// what core knows.
export const folderDetails: DetailsOf = () => null;

export const folderPresentation: Presentation = { name: "Folder", details: folderDetails };
