// Mirrors core's `parseItemId`, which the page can't import; a test holds the two together.
const itemIdShape = /^([a-z]{2,16})(?:\.(?:[2-9]|[1-9][0-9]{1,3}))?:[A-Za-z0-9._-]{1,128}$/;

export const isItemId = (id: string): boolean => itemIdShape.test(id);

export const kindOfItem = (id: string): string | null => itemIdShape.exec(id)?.[1] ?? null;
