-- Who named a group. Oriel names every group it makes and may name it again:
-- a group copied from an epic's cluster follows the epic's title. Once the
-- user names a group, Oriel never does again, so that is all this keeps: one
-- row per group the user named.
create table user_named_groups (
  workspace_id text not null references workspaces (id),
  group_id text primary key references groups (id)
) strict;

-- Nothing recorded who named the groups made before now, so each counts as
-- the user's unless its name is still one Oriel gave it: a thread's group
-- still called "New group"; a cluster's group with the empty name 0002 gave
-- it, or "Untitled", or its anchor's title as the index last had it, whole or
-- cut to the 120 characters a name may have. The user can't give an empty
-- name.
insert into user_named_groups (workspace_id, group_id)
  select g.workspace_id, g.id from groups g
  where not (
    (json_extract(g.origin, '$.kind') = 'thread' and g.name = 'New group')
    or (json_extract(g.origin, '$.kind') = 'cluster' and g.name in ('', 'Untitled'))
    or exists (
      select 1 from items i
      where i.workspace_id = g.workspace_id
        and i.source = substr(json_extract(g.origin, '$.anchor.id'), 1,
          instr(json_extract(g.origin, '$.anchor.id'), ':') - 1)
        and i.stable_id = json_extract(g.origin, '$.anchor.stableId')
        and g.name in (i.title, substr(i.title, 1, 120))));
