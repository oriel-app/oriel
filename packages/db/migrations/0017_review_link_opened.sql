-- When someone first opened a review link, so the overview can say which
-- links went out and nobody has opened (decision 0027). Null until then,
-- and for a link opened before Oriel kept it.
alter table review_links add column opened_at text;
