-- =====================================================================
-- Cyrix KPI  ·  0185  ·  Join opens when the poster says; YouTube videos
--
-- The user, 13 Oct: "when add meeting link we need option to enter buffer
-- time also, if I want to keep 30 mins before then I can customise it";
-- "we are posting videos in YouTube, so I need to put the link in digest ...
-- will it show the template, and we can easily track who clicked".
--
-- join_early: minutes before the start that the link is given, Join works
-- and the reminder goes (15 unless chosen). A Video post carries a YouTube
-- video id; it plays inside Digest, so the player can say how long each
-- person watched (digest_video_views, written by digest_video_progress).
-- =====================================================================

alter table digest_posts add column if not exists join_early int not null default 15;
alter table digest_posts drop constraint if exists digest_posts_join_early_check;
alter table digest_posts add constraint digest_posts_join_early_check check (join_early between 0 and 240);

alter table digest_posts add column if not exists video_id text;
alter table digest_posts drop constraint if exists digest_posts_video_check;
alter table digest_posts add constraint digest_posts_video_check
  check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');
alter table digest_posts drop constraint if exists digest_posts_kind_check;
alter table digest_posts add constraint digest_posts_kind_check
  check (kind in ('news', 'meeting', 'poll', 'announcement', 'alert', 'notice', 'vacancy', 'form', 'video'));

create or replace function digest_set_join_early(p_id uuid, p_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_minutes is null or p_minutes not between 0 and 240 then raise exception 'Join opens 0 to 240 minutes before'; end if;
  update digest_posts set join_early = p_minutes where id = p_id and kind = 'meeting' and digest_can_edit(id);
  if not found then raise exception 'Only the desks that can edit it'; end if;
end $$;
revoke all on function digest_set_join_early(uuid, int) from public, anon;
grant execute on function digest_set_join_early(uuid, int) to authenticated;

create or replace function digest_set_video(p_id uuid, p_video_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_video_id, '') !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'That is not a YouTube video link'; end if;
  update digest_posts set video_id = p_video_id where id = p_id and kind = 'video' and digest_can_edit(id);
  if not found then raise exception 'Only the desks that can edit it'; end if;
end $$;
revoke all on function digest_set_video(uuid, text) from public, anon;
grant execute on function digest_set_video(uuid, text) to authenticated;

-- How far each person got into a video: the most they watched, and the video's length.
create table if not exists digest_video_views (
  post_id uuid not null references digest_posts (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  watched_seconds int not null default 0,
  duration_seconds int,
  primary key (post_id, employee_id)
);
alter table digest_video_views enable row level security;
revoke all on digest_video_views from anon, authenticated;

create or replace function digest_video_progress(p_id uuid, p_seconds int, p_duration int)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id();
begin
  if me is null then return; end if;
  if not exists (select 1 from digest_posts where id = p_id and kind = 'video' and deleted_at is null and published_at is not null) then return; end if;
  insert into digest_video_views (post_id, employee_id, watched_seconds, duration_seconds)
  values (p_id, me, greatest(0, least(coalesce(p_seconds, 0), 86400)), nullif(p_duration, 0))
  on conflict (post_id, employee_id) do update
  set watched_seconds = greatest(digest_video_views.watched_seconds, excluded.watched_seconds),
      duration_seconds = coalesce(excluded.duration_seconds, digest_video_views.duration_seconds),
      updated_at = now();
end $$;
revoke all on function digest_video_progress(uuid, int, int) from public, anon;
grant execute on function digest_video_progress(uuid, int, int) to authenticated;

drop function if exists digest_feed(int, timestamptz);
CREATE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, liked boolean, comments integer, vac_location text, apply_by date, apply_link text, has_link boolean, join_early integer, video_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.kind, p.title, p.body, p.image_url, p.color,
         p.meet_at, p.meet_minutes,
         -- The link itself only from 15 minutes before the start (0182); has_link says one is set.
         case when p.meet_at - make_interval(mins => p.join_early) <= now() then p.meet_link end,
         p.meet_place,
         p.posted_as, e.full_name, p.published_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         exists (select 1 from digest_likes l where l.post_id = p.id and l.employee_id = current_employee_id()),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         p.vac_location, p.apply_by, p.apply_link,
         p.meet_link is not null,
         p.join_early, p.video_id
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and current_employee_id() is not null
    -- Published only: a draft is the posting desk's alone (0182).
    and p.published_at is not null
    and (p_before is null or p.published_at < p_before)
    -- Shown until its last day, when it has one: Show until (0177), and for a
    -- vacancy its Apply by, for a poll the day it closes (0178).
    and coalesce(digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at), 'infinity'::date)
        >= (now() at time zone 'Asia/Kolkata')::date
    -- A meeting, once it is over (0179).
    and (p.kind <> 'meeting' or p.meet_at is null
         or p.meet_at + make_interval(mins => coalesce(p.meet_minutes, 60)) > now())
  order by p.published_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$;
grant execute on function digest_feed(int, timestamptz) to authenticated;

drop function if exists digest_admin_list();
CREATE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone, can_edit boolean, editors text[], opened integer, join_early integer, video_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare desk text := digest_can_post();
begin
  if desk is null then raise exception 'Only HR, IT or Marketing'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.image_url, p.color, p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         (select count(*)::int from digest_joins j where j.post_id = p.id),
         p.posted_as = desk,
         p.vac_location, p.apply_by, p.apply_link, case when p.kind = 'meeting' then (p.meet_at at time zone 'Asia/Kolkata')::date
              else digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at) end,
         p.published_at,
         true, p.editors,
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null),
         p.join_early, p.video_id
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and (p.posted_as = desk or desk = any (p.editors))
  order by p.created_at desc
  limit 500;
end $function$;
grant execute on function digest_admin_list() to authenticated;

drop function if exists digest_post_people(uuid);
CREATE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb, watched_seconds integer, video_seconds integer, watched_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and digest_can_edit(id)) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, e.department, e.function_name,
         v.seen_at, v.opened_at, coalesce(v.opens, 0),
         l.created_at,
         (select count(*)::int from digest_comments c where c.post_id = p_id and c.employee_id = e.id and c.deleted_at is null),
         (select count(*)::int from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select min(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select string_agg(o.label, ', ' order by o.position) from digest_votes dv join digest_poll_options o on o.id = dv.option_id where dv.post_id = p_id and dv.employee_id = e.id),
         fr.updated_at, fr.answers,
         vw.watched_seconds, vw.duration_seconds, vw.started_at
  from employees e
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  left join digest_form_responses fr on fr.post_id = p_id and fr.employee_id = e.id
  left join digest_video_views vw on vw.post_id = p_id and vw.employee_id = e.id
  where e.is_active and position('_' in e.ecode) = 0
  order by e.full_name;
end $function$;
grant execute on function digest_post_people(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_join(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); link text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select meet_link into link from digest_posts where id = p_id and kind = 'meeting' and deleted_at is null and published_at is not null;
  if link is null then raise exception 'The meeting link has not been shared yet'; end if;
  -- Not before 15 minutes ahead of the start (0182).
  if (select meet_at - make_interval(mins => join_early) from digest_posts where id = p_id) > now() then
    raise exception 'Join opens % minutes before the meeting', (select join_early from digest_posts where id = p_id);
  end if;
  insert into digest_joins (post_id, employee_id) values (p_id, me);
  return link;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_meetings_due()
 RETURNS TABLE(id uuid, title text, meet_at timestamp with time zone, meet_place text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.title, p.meet_at, p.meet_place from digest_posts p
  where p.kind = 'meeting' and p.deleted_at is null and p.published_at is not null
    -- When Join opens (0185): 15 minutes before by default, or the post's own choice.
    and p.meet_at between now() + make_interval(mins => greatest(p.join_early - 6, 0)) and now() + make_interval(mins => p.join_early + 1)
    and not exists (select 1 from push_messages m where m.dedupe_key = 'digest-reminder:' || p.id)
$function$;

CREATE OR REPLACE FUNCTION public.digest_toggle_like(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select kind from digest_posts where id = p_id and deleted_at is null) not in ('news', 'announcement', 'alert', 'notice', 'vacancy', 'video') then
    raise exception 'A meeting or a poll cannot be liked';
  end if;
  if exists (select 1 from digest_likes where post_id = p_id and employee_id = me) then
    delete from digest_likes where post_id = p_id and employee_id = me;
    return false;
  end if;
  insert into digest_likes (post_id, employee_id) values (p_id, me);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_last_day(p_kind text, p_show_until date, p_apply_by date, p_closes_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_kind
           when 'vacancy' then p_apply_by
           when 'poll' then (p_closes_at at time zone 'Asia/Kolkata')::date
           when 'form' then (p_closes_at at time zone 'Asia/Kolkata')::date
           else p_show_until
         end
$function$;
