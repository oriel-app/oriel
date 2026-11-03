-- The window chat (decisions 0027 and 0030): a thread its first question
-- made, on a workstream of its own. `left_at`: when the user left it with
-- New chat, after which it is no longer the one the window shows, even while
-- it stays working, as when a change set in it waits on them.
create table window_chats (
  thread_id text primary key references threads (id),
  workspace_id text not null references workspaces (id),
  left_at text
) strict;
