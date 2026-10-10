-- =====================================================================
-- Cyrix KPI  ·  0166  ·  Each post's numbers, and who
--
-- The user, 10 Oct: "each post analytics should be there also, who all
-- clicked, not liked etc, a summary". Two more things are recorded:
--   seen    the post appeared on their Cyrix home page (once is enough)
--   opened  they tapped into it (how often, first and last)
-- With likes, comments and Join clicks, a post's summary is everybody
-- active and where each of them got to — including who has not seen it.
-- Only HR, IT and Marketing read it.
-- =====================================================================

create table if not exists digest_views (
  post_id      uuid not null references digest_posts(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  seen_at      timestamptz not null default now(),
  opened_at    timestamptz,
  last_opened  timestamptz,
  opens        int not null default 0,
  primary key (post_id, employee_id)
);
alter table digest_views enable row level security;

-- The home page shows these posts: seen, once each.
create or replace function digest_seen(p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  insert into digest_views (post_id, employee_id)
  select p.id, current_employee_id() from digest_posts p
  where p.id = any (p_ids) and p.deleted_at is null and current_employee_id() is not null
  on conflict do nothing
$$;

-- Tapped into one.
create or replace function digest_opened(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  insert into digest_views (post_id, employee_id, opened_at, last_opened, opens)
  select p_id, current_employee_id(), now(), now(), 1
  where current_employee_id() is not null and exists (select 1 from digest_posts where id = p_id and deleted_at is null)
  on conflict (post_id, employee_id) do update
    set opened_at = coalesce(digest_views.opened_at, now()), last_opened = now(), opens = digest_views.opens + 1
$$;

grant execute on function digest_seen(uuid[]), digest_opened(uuid) to authenticated;

-- Everybody active, and how far each got with this post.
create or replace function digest_post_people(p_id uuid)
returns table (ecode text, full_name text, department text, function_name text,
               seen_at timestamptz, opened_at timestamptz, opens int,
               liked_at timestamptz, comments int, joins int, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select e.ecode, e.full_name, e.department, e.function_name,
         v.seen_at, v.opened_at, coalesce(v.opens, 0),
         l.created_at,
         (select count(*)::int from digest_comments c where c.post_id = p_id and c.employee_id = e.id and c.deleted_at is null),
         (select count(*)::int from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select min(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id)
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  where e.is_active and position('_' in e.ecode) = 0
  order by e.full_name;
end $$;
grant execute on function digest_post_people(uuid) to authenticated;
