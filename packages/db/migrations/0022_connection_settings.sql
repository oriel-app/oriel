-- How often a connection syncs while Oriel is open (decision 0049), in
-- minutes; null for when Oriel starts and when asked. A tombstone keeps none.
alter table connections add column sync_every integer check (sync_every in (5, 15, 60));
