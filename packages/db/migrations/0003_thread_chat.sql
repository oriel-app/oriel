-- A thread's chat (decision 0018): what the user said, what the agent did,
-- and a marker wherever the thread moved to a newer version of its group. A
-- marker records only the two versions; what changed between them is in
-- group_changes and group_members, so nothing is copied. Widening the role
-- check is a rebuild in SQLite.
create table new_messages (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  seq integer not null,
  role text not null check (role in ('user', 'agent', 'marker')),
  content text not null check (json_valid(content)),
  at text not null,
  unique (thread_id, seq)
) strict;
insert into new_messages (id, workspace_id, thread_id, seq, role, content, at)
  select id, workspace_id, thread_id, seq, role, content, at from messages;
drop table messages;
alter table new_messages rename to messages;

-- The inbox and the window list a workspace's threads and groups.
create index threads_by_group on threads (group_id);
create index groups_by_workspace on groups (workspace_id, created_at);
