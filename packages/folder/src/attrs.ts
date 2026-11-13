import {
  type DetailsOf,
  type Facets,
  type IndexRecord,
  nullable,
  type PanelOf,
  object,
  type Presentation,
  string,
  type Validator,
} from "@oriel/core";

// Shape only, never source text: this lands in the declarations' `Item`.
export const folderItemDoc =
  "A folder item is a markdown file: its title is the file's name, its text the file, or a note that it's too large to read. It has no status, assignee or estimate.";

export type FolderAttrs = Record<string, never>;

export type FolderRecord = IndexRecord<"folder", FolderAttrs>;

export type FolderContent = {
  title: string;
  text: string;
  note: string | null;
};

export const folderAttrs: Validator<FolderAttrs> = object({});

export const folderContent = object({
  title: string,
  text: string,
  note: nullable(string),
}) satisfies Validator<FolderContent>;

export const folderFacets = (): Facets => ({ kind: "doc" });

export const folderDetails: DetailsOf = () => null;

// A file's name is its title, never its key, so no name a person wrote reaches an ID.
export const folderKeyShape = /^[0-9a-f]{16}$/;

export const folderPresentation: Presentation = {
  name: "Folder",
  inSentence: "the folder",
  icon: "page",
  keysReadAs: "File",
  columns: [],
  details: folderDetails,
};

export const folderPanel: PanelOf = (content) => {
  const read = folderContent(content);
  if (!read.ok) return null;
  const { text, note } = read.value;
  if (note !== null && text === note)
    return { title: null, blocks: [{ kind: "note", text: note }] };
  return {
    title: null,
    blocks: [
      ...(note === null ? [] : [{ kind: "note" as const, text: note }]),
      { kind: "text", heading: null, text, format: "markdown" },
    ],
  };
};
