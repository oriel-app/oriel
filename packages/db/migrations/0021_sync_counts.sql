-- What each source's last sync changed: how many items were new, changed
-- and removed (gone from the source), kept with its sync state. A sync that
-- changed nothing keeps zeros. `added_in` is the snapshot version an item
-- last became live in, new or back from gone, so a sync tells its new items
-- from those it changed; items indexed before it have none, and count as
-- changed.
alter table items add column added_in integer;
alter table sources add column new_items integer not null default 0 check (new_items >= 0);
alter table sources add column changed_items integer not null default 0 check (changed_items >= 0);
alter table sources add column removed_items integer not null default 0 check (removed_items >= 0);
