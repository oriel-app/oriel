-- Search's full-text index over the live items (OA-264): each one's key,
-- title and text as core's `indexFold` folds them, which the database runs
-- as search_fold, a function every connection `open` makes has. It keeps no
-- copy of what it indexes, only the index, by the item's rowid; `items`
-- keeps the text as written, for excerpts. The index store writes it in the
-- same transaction as the items it changes: an item is in it while it is
-- live. A migration that rebuilds `items` rebuilds this from it too, since
-- rowids may change.
create virtual table item_search using fts5 (
  key, title, text,
  content = '', contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2 categories ''L* N* Co M*'''
);

insert into item_search (rowid, key, title, text)
select rowid, search_fold(substr(item_id, length(source) + 2)), search_fold(title),
  search_fold(coalesce(text, ''))
from items where gone_at is null;
