-- Each item's text, as far as search keeps it (OA-242): the first 8,192
-- characters of what its source's sync gave, so search() and Browse find an
-- item by its text too. Null until a sync gives it. Every cursor starts over,
-- so the next sync of each source is a full one and gives every item's text.
alter table items add column text text check (text is null or length(text) <= 8192);
update sources set cursor = null;
