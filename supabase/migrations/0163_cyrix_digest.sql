-- =====================================================================
-- Cyrix KPI  ·  0163  ·  Cyrix Digest
--
-- The user, 10 Oct: company news and meetings on the Cyrix home page,
-- "very attractive and colourful", under the module tiles. HR Admin and
-- IT Admin post; everybody sees every post, can like it (not a meeting)
-- and comment; a new post notifies everybody (bell and devices) and a
-- meeting reminds everybody 15 minutes before. Join on a meeting is
-- counted — who clicked, how often, first and last — for HR and IT. How
-- long somebody stayed cannot be seen from here: Teams opens in Teams.
-- =====================================================================

create table if not exists digest_posts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('news', 'meeting')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text not null default '' check (length(body) <= 4000),
  image_url    text,
  color        text not null default 'red' check (color in ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  meet_at      timestamptz,
  meet_minutes int check (meet_minutes between 5 and 600),
  meet_link    text,
  meet_place   text,
  posted_by    uuid references employees(id) on delete set null,
  posted_as    text not null check (posted_as in ('hr', 'it')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (kind <> 'meeting' or (meet_at is not null and coalesce(meet_link, '') ~ '^https://'))
);
create index if not exists digest_posts_created on digest_posts(created_at desc) where deleted_at is null;

create table if not exists digest_likes (
  post_id     uuid not null references digest_posts(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, employee_id)
);

create table if not exists digest_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references digest_posts(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists digest_comments_post on digest_comments(post_id, created_at);

create table if not exists digest_joins (
  id          bigserial primary key,
  post_id     uuid not null references digest_posts(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  clicked_at  timestamptz not null default now()
);
create index if not exists digest_joins_post on digest_joins(post_id);

alter table digest_posts enable row level security;
alter table digest_likes enable row level security;
alter table digest_comments enable row level security;
alter table digest_joins enable row level security;
-- No policies: everything through the functions below.

-- Pictures: a public bucket, written only by HR and IT.
insert into storage.buckets (id, name, public) values ('digest', 'digest', true)
on conflict (id) do update set public = true;
drop policy if exists digest_upload on storage.objects;
create policy digest_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'digest' and (is_hr_admin() or is_it_admin()));
drop policy if exists digest_remove on storage.objects;
create policy digest_remove on storage.objects for delete to authenticated
  using (bucket_id = 'digest' and (is_hr_admin() or is_it_admin()));

-- Push: a post goes out as HR or IT.
alter table push_messages drop constraint if exists push_messages_sent_as_check;
alter table push_messages add constraint push_messages_sent_as_check check (sent_as in ('hr', 'sw', 'it'));


-- ---------------------------------------------------------------------
create or replace function digest_can_post()
returns text
language sql stable security definer set search_path = public as $$
  select case when is_hr_admin() then 'hr' when is_it_admin() then 'it' end
$$;

create or replace function digest_save(
  p_id uuid, p_kind text, p_title text, p_body text, p_image_url text, p_color text,
  p_meet_at timestamptz default null, p_meet_minutes int default null,
  p_meet_link text default null, p_meet_place text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  desk text := digest_can_post();
  v    uuid;
begin
  if desk is null then raise exception 'Only HR Admin or IT Admin can post to Cyrix Digest'; end if;
  if p_kind = 'meeting' and (p_meet_at is null or coalesce(p_meet_link, '') !~ '^https://') then
    raise exception 'A meeting needs a date and time, and a link starting with https://';
  end if;
  if p_id is null then
    insert into digest_posts (kind, title, body, image_url, color, meet_at, meet_minutes, meet_link, meet_place, posted_by, posted_as)
    values (p_kind, btrim(p_title), coalesce(p_body, ''), nullif(p_image_url, ''), coalesce(p_color, 'red'),
            case when p_kind = 'meeting' then p_meet_at end, case when p_kind = 'meeting' then p_meet_minutes end,
            case when p_kind = 'meeting' then btrim(p_meet_link) end, case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
            current_employee_id(), desk)
    returning id into v;
  else
    update digest_posts set kind = p_kind, title = btrim(p_title), body = coalesce(p_body, ''),
      image_url = nullif(p_image_url, ''), color = coalesce(p_color, 'red'),
      meet_at = case when p_kind = 'meeting' then p_meet_at end,
      meet_minutes = case when p_kind = 'meeting' then p_meet_minutes end,
      meet_link = case when p_kind = 'meeting' then btrim(p_meet_link) end,
      meet_place = case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
      updated_at = now()
    where id = p_id and deleted_at is null
    returning id into v;
    if v is null then raise exception 'That post is not there any more'; end if;
  end if;
  return v;
end $$;

create or replace function digest_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR Admin or IT Admin can remove a post'; end if;
  update digest_posts set deleted_at = now() where id = p_id;
end $$;

-- The feed: newest first, the next meeting still to come flagged.
create or replace function digest_feed(p_limit int default 20, p_before timestamptz default null)
returns table (id uuid, kind text, title text, body text, image_url text, color text,
               meet_at timestamptz, meet_minutes int, meet_link text, meet_place text,
               posted_as text, author text, created_at timestamptz,
               likes int, liked boolean, comments int)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.title, p.body, p.image_url, p.color,
         p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         exists (select 1 from digest_likes l where l.post_id = p.id and l.employee_id = current_employee_id()),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null)
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and current_employee_id() is not null
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function digest_toggle_like(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select kind from digest_posts where id = p_id and deleted_at is null) is distinct from 'news' then
    raise exception 'Only news can be liked';
  end if;
  if exists (select 1 from digest_likes where post_id = p_id and employee_id = me) then
    delete from digest_likes where post_id = p_id and employee_id = me;
    return false;
  end if;
  insert into digest_likes (post_id, employee_id) values (p_id, me);
  return true;
end $$;

create or replace function digest_comments_for(p_id uuid)
returns table (id uuid, author text, ecode text, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select c.id, e.full_name, e.ecode, c.body, c.created_at,
         c.employee_id = current_employee_id() or digest_can_post() is not null
  from digest_comments c join employees e on e.id = c.employee_id
  where c.post_id = p_id and c.deleted_at is null and current_employee_id() is not null
  order by c.created_at
$$;

create or replace function digest_add_comment(p_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from digest_posts where id = p_id and deleted_at is null) then raise exception 'That post is not there any more'; end if;
  insert into digest_comments (post_id, employee_id, body) values (p_id, me, btrim(p_body)) returning id into v;
  return v;
end $$;

create or replace function digest_delete_comment(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update digest_comments set deleted_at = now()
  where id = p_id and (employee_id = current_employee_id() or digest_can_post() is not null);
end $$;

-- Join: counted, then the link.
create or replace function digest_join(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); link text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select meet_link into link from digest_posts where id = p_id and kind = 'meeting' and deleted_at is null;
  if link is null then raise exception 'That meeting is not there any more'; end if;
  insert into digest_joins (post_id, employee_id) values (p_id, me);
  return link;
end $$;

-- For HR and IT: every post with its numbers, and who clicked Join.
create or replace function digest_admin_list()
returns table (id uuid, kind text, title text, body text, image_url text, color text,
               meet_at timestamptz, meet_minutes int, meet_link text, meet_place text,
               posted_as text, author text, created_at timestamptz,
               likes int, comments int, joined int, clicks int)
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR Admin or IT Admin'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.image_url, p.color, p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         (select count(*)::int from digest_joins j where j.post_id = p.id)
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null
  order by p.created_at desc
  limit 100;
end $$;

create or replace function digest_join_report(p_id uuid)
returns table (ecode text, full_name text, department text, clicks int, first_at timestamptz, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR Admin or IT Admin'; end if;
  return query
  select e.ecode, e.full_name, e.department, count(*)::int, min(j.clicked_at), max(j.clicked_at)
  from digest_joins j join employees e on e.id = j.employee_id
  where j.post_id = p_id
  group by e.ecode, e.full_name, e.department
  order by min(j.clicked_at);
end $$;

-- Who liked, for HR and IT.
create or replace function digest_likers(p_id uuid)
returns table (ecode text, full_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR Admin or IT Admin'; end if;
  return query
  select e.ecode, e.full_name, l.created_at from digest_likes l join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.created_at;
end $$;

grant execute on function digest_can_post(), digest_feed(int, timestamptz), digest_toggle_like(uuid),
  digest_comments_for(uuid), digest_add_comment(uuid, text), digest_delete_comment(uuid), digest_join(uuid),
  digest_remove(uuid), digest_admin_list(), digest_join_report(uuid), digest_likers(uuid) to authenticated;
grant execute on function digest_save(uuid, text, text, text, text, text, timestamptz, int, text, text) to authenticated;

-- Meetings about to start, for the 15-minute reminder (the push function's bell run).
create or replace function digest_meetings_due()
returns table (id uuid, title text, meet_at timestamptz, meet_place text)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.meet_at, p.meet_place from digest_posts p
  where p.kind = 'meeting' and p.deleted_at is null
    and p.meet_at between now() + interval '9 minutes' and now() + interval '16 minutes'
    and not exists (select 1 from push_messages m where m.dedupe_key = 'digest-reminder:' || p.id)
$$;
revoke execute on function digest_meetings_due() from public, anon, authenticated;
grant execute on function digest_meetings_due() to service_role;
