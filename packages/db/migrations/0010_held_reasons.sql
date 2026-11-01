-- A review-link holder's reason for rejecting is held in the thread, under
-- their name, until the person sends it to the agent, edited or not, or
-- discards it (decision 0024). It is a chat entry of its own, 'held', so
-- nothing that reads the person's messages takes it for one. Widening the
-- role check is a rebuild in SQLite.
create table new_messages (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  seq integer not null,
  role text not null check (role in ('user', 'agent', 'marker', 'held')),
  content text not null check (json_valid(content)),
  at text not null,
  unique (thread_id, seq)
) strict;
insert into new_messages (id, workspace_id, thread_id, seq, role, content, at)
  select id, workspace_id, thread_id, seq, role, content, at from messages;
drop table messages;
alter table new_messages rename to messages;
