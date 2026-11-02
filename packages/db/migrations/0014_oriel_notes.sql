-- Oriel's own lines in a thread, such as asking what was wrong with a
-- rejected change set, were stored as the agent's text, so the agent read
-- them back as its own words (OA-91). A note is a chat entry of its own,
-- 'note', holding what happened rather than the words: which change set was
-- rejected, and where (OA-86). Widening the role check is a rebuild in
-- SQLite.
create table new_messages (
  id text primary key,
  workspace_id text not null references workspaces (id),
  thread_id text not null references threads (id),
  seq integer not null,
  role text not null check (role in ('user', 'agent', 'marker', 'held', 'note')),
  content text not null check (json_valid(content)),
  at text not null,
  unique (thread_id, seq)
) strict;
insert into new_messages (id, workspace_id, thread_id, seq, role, content, at)
  select id, workspace_id, thread_id, seq, role, content, at from messages;
drop table messages;
alter table new_messages rename to messages;
-- Each line Oriel wrote after a rejection becomes a note naming the change
-- set: the thread's latest rejection at or before the line, made where the
-- line says (the user's own, or on a review link, which an older line named
-- its holder for), of a change set the agent proposed, never an Undo, which
-- Oriel never asked about. A line with no such rejection stays as it was.
create temporary table rejection_lines as
select m.id, (
    select json_object('kind', 'rejected', 'changeSet', d.change_set_id, 'via', d.via)
    from decisions d join change_sets c on c.id = d.change_set_id
    where c.thread_id = m.thread_id and c.revert_of is null
      and d.kind = 'rejected' and d.at <= m.at
      and d.via = case
        when json_extract(m.content, '$.text') like 'You rejected this change set%' then 'thread'
        else 'review-link'
      end
    order by d.at desc, d.seq desc
    limit 1
  ) as note
from messages m
where m.role = 'agent'
  and json_extract(m.content, '$.kind') = 'text'
  and (
    json_extract(m.content, '$.text')
      like '% rejected this change set, so nothing in it will change. What was wrong with it?%'
    or json_extract(m.content, '$.text')
      like 'This change set was rejected on its review link, so nothing in it will change. What was wrong with it?%'
  );
update messages
set role = 'note', content = (select note from rejection_lines r where r.id = messages.id)
where id in (select id from rejection_lines where note is not null);
drop table rejection_lines;
