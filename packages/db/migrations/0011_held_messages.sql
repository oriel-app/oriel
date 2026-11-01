-- A held entry is a message from anyone but the user, and says who it is
-- from (decision 0024): a review link's holder now, another thread's agent
-- or an outside tool later. What only a review link's holder sends (their
-- name and the change set they rejected) moves under `from`. In place of
-- whether Oriel asked what was wrong with the change set as it was held,
-- `askFirst` says whether it still is to, before the reason reaches the
-- agent: not if it asked, and never for an Undo.
update messages
set content = json_object(
  'from', json_object(
    'kind', 'review-link',
    'by', json_extract(content, '$.by'),
    'changeSet', json_extract(content, '$.changeSet'),
    'askFirst', json(
      case
        when json_extract(content, '$.asked') then 'false'
        when exists (
          select 1 from change_sets
          where change_sets.id = json_extract(messages.content, '$.changeSet')
            and change_sets.revert_of is not null
        ) then 'false'
        else 'true'
      end
    )
  ),
  'text', json_extract(content, '$.text'),
  'outcome', json_extract(content, '$.outcome')
)
where role = 'held';
