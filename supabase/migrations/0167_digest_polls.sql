-- =====================================================================
-- Cyrix KPI  ·  0167  ·  Polls in Cyrix Digest
--
-- The user, 10 Oct: "they can post polls also". A poll is a question
-- with 2 to 6 options, single choice or multiple choice (multi — the
-- user: "single select or multiselect answers"); each person may change
-- their answer until the poll closes (closes_at, optional). Results show once you have
-- voted. HR, IT and Marketing see who voted what in the post's analytics.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_kind_check;
alter table digest_posts add constraint digest_posts_kind_check check (kind in ('news', 'meeting', 'poll'));
alter table digest_posts add column if not exists closes_at timestamptz;
alter table digest_posts add column if not exists multi boolean not null default false;

create table if not exists digest_poll_options (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references digest_posts(id) on delete cascade,
  label    text not null check (length(btrim(label)) between 1 and 120),
  position int not null
);
create index if not exists digest_poll_options_post on digest_poll_options(post_id, position);

create table if not exists digest_votes (
  post_id     uuid not null references digest_posts(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  option_id   uuid not null references digest_poll_options(id) on delete cascade,
  voted_at    timestamptz not null default now(),
  primary key (post_id, employee_id, option_id)
);
alter table digest_poll_options enable row level security;
alter table digest_votes enable row level security;

-- The options of a poll, set by whoever posted it. Changing them once
-- people have voted would change what they voted for, so it is refused.
create or replace function digest_set_poll(p_id uuid, p_options text[], p_closes_at timestamptz default null, p_multi boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare opts text[];
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'poll' and deleted_at is null and posted_as = digest_can_post()) then
    raise exception 'Only whoever posted the poll can set its options';
  end if;
  select array_agg(btrim(o) order by n) into opts
  from unnest(p_options) with ordinality as t(o, n) where btrim(coalesce(o, '')) <> '';
  if coalesce(cardinality(opts), 0) < 2 or cardinality(opts) > 6 then
    raise exception 'A poll needs 2 to 6 options';
  end if;
  update digest_posts set closes_at = p_closes_at, multi = coalesce(p_multi, false) where id = p_id;
  if exists (select 1 from digest_votes where post_id = p_id) then
    if opts is distinct from (select array_agg(label order by position) from digest_poll_options where post_id = p_id) then
      raise exception 'People have voted already, so the options cannot change';
    end if;
    return;
  end if;
  delete from digest_poll_options where post_id = p_id;
  insert into digest_poll_options (post_id, label, position)
  select p_id, o, n::int from unnest(opts) with ordinality as t(o, n);
end $$;

-- An answer: one option, or several on a multiple-choice poll. It replaces the last one.
create or replace function digest_vote(p_id uuid, p_options uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  me    uuid := current_employee_id();
  multi boolean;
  n     int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select p.multi into multi from digest_posts p where p.id = p_id and p.kind = 'poll' and p.deleted_at is null;
  if multi is null then raise exception 'That poll is not there any more'; end if;
  if (select closes_at from digest_posts where id = p_id) < now() then raise exception 'This poll has closed'; end if;
  select count(*) into n from digest_poll_options where post_id = p_id and id = any (p_options);
  if n = 0 then raise exception 'Choose an answer'; end if;
  if n <> coalesce(cardinality(p_options), 0) then raise exception 'That answer is not in this poll'; end if;
  if not multi and n > 1 then raise exception 'Choose one answer'; end if;
  delete from digest_votes where post_id = p_id and employee_id = me;
  insert into digest_votes (post_id, employee_id, option_id) select p_id, me, unnest(p_options);
end $$;

-- A poll's options with their votes, and this person's own vote.
create or replace function digest_poll(p_id uuid)
returns table (id uuid, label text, votes int, mine boolean, closes_at timestamptz, multi boolean, voters int)
language sql stable security definer set search_path = public as $$
  select o.id, o.label,
         (select count(*)::int from digest_votes v where v.option_id = o.id),
         exists (select 1 from digest_votes v where v.option_id = o.id and v.employee_id = current_employee_id()),
         p.closes_at, p.multi,
         (select count(distinct v.employee_id)::int from digest_votes v where v.post_id = p_id)
  from digest_poll_options o join digest_posts p on p.id = o.post_id
  where o.post_id = p_id and current_employee_id() is not null
  order by o.position
$$;

grant execute on function digest_set_poll(uuid, text[], timestamptz, boolean), digest_vote(uuid, uuid[]), digest_poll(uuid) to authenticated;

-- Analytics gain the vote.
drop function if exists digest_post_people(uuid);
create function digest_post_people(p_id uuid)
returns table (ecode text, full_name text, department text, function_name text,
               seen_at timestamptz, opened_at timestamptz, opens int,
               liked_at timestamptz, comments int, joins int, joined_at timestamptz, voted text)
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select e.ecode, e.full_name, e.department, e.function_name,
         v.seen_at, v.opened_at, coalesce(v.opens, 0),
         l.created_at,
         (select count(*)::int from digest_comments c where c.post_id = p_id and c.employee_id = e.id and c.deleted_at is null),
         (select count(*)::int from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select min(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select string_agg(o.label, ', ' order by o.position) from digest_votes dv join digest_poll_options o on o.id = dv.option_id where dv.post_id = p_id and dv.employee_id = e.id)
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  where e.is_active and position('_' in e.ecode) = 0
  order by e.full_name;
end $$;
grant execute on function digest_post_people(uuid) to authenticated;
