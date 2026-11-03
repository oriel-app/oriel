// An item ID's shape, as core's `parseItemId` checks it, which the page can't
// import: a short lowercase kind, a later connection's number, a colon, then
// a key (decision 0049). A test holds the two together.
const itemIdShape = /^([a-z]{2,16})(?:\.(?:[2-9]|[1-9][0-9]{1,3}))?:[A-Za-z0-9._-]{1,128}$/;

export const isItemId = (id: string): boolean => itemIdShape.test(id);

// What an item is, such as `folder`, whichever connection it is from; null
// for anything else.
export const kindOfItem = (id: string): string | null => itemIdShape.exec(id)?.[1] ?? null;
