-- A form or poll leaves the home page the moment it closes, not at midnight (the user, 15 Oct:
-- "already closed then why here?"). SW Admin's Digest tab shows Ended, not Live, for a meeting
-- that is over, a form or poll that has closed, or a post past its last day.
create or replace function public.digest_ended(p_kind text, p_meet_at timestamptz, p_meet_minutes int,
  p_show_until date, p_apply_by date, p_closes_at timestamptz)
returns boolean language sql stable set search_path to 'public' as $f$
  select case
    when p_kind = 'meeting' then p_meet_at is not null and p_meet_at + make_interval(mins => coalesce(p_meet_minutes, 60)) <= now()
    when p_kind in ('poll', 'form') then p_closes_at is not null and p_closes_at <= now()
    else coalesce(digest_last_day(p_kind, p_show_until, p_apply_by, p_closes_at), 'infinity'::date) < (now() at time zone 'Asia/Kolkata')::date
  end
$f$;

CREATE OR REPLACE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, liked boolean, comments integer, vac_location text, apply_by date, apply_link text, has_link boolean, join_early integer, video_id text, is_test boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.kind, p.title, p.body, p.image_url, p.color,
         p.meet_at, p.meet_minutes,
         -- The link itself only from 15 minutes before the start (0182); has_link says one is set.
         case when p.meet_at - make_interval(mins => p.join_early) <= now() or p.published_at is null then p.meet_link end,
         p.meet_place,
         p.posted_as, e.full_name, coalesce(p.published_at, p.created_at),
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         exists (select 1 from digest_likes l where l.post_id = p.id and l.employee_id = current_employee_id()),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         p.vac_location, p.apply_by, p.apply_link,
         p.meet_link is not null,
         p.join_early, p.video_id,
         p.published_at is null
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and current_employee_id() is not null
    -- Published only: a draft is the posting desk's alone (0182).
    -- A test of a draft (0187) reaches only the people it was sent to.
    and (p.published_at is not null or current_employee_id() = any (p.testers))
    and (p_before is null or coalesce(p.published_at, p.created_at) < p_before)
    -- Shown until its last day, when it has one: Show until (0177), and for a
    -- vacancy its Apply by, for a poll the day it closes (0178).
    and (p.kind not in ('poll', 'form') or p.closes_at is null or p.closes_at > now())
    and coalesce(digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at), 'infinity'::date)
        >= (now() at time zone 'Asia/Kolkata')::date
    -- A meeting, once it is over (0179).
    and (p.kind <> 'meeting' or p.meet_at is null
         or p.meet_at + make_interval(mins => coalesce(p.meet_minutes, 60)) > now())
  order by p.published_at is null desc, coalesce(p.published_at, p.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$;


drop function if exists public.digest_sw_list();
CREATE FUNCTION public.digest_sw_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, posted_as text, author text, created_at timestamp with time zone, published_at timestamp with time zone, deleted_at timestamp with time zone, deleted_by text, meet_at timestamp with time zone, likes integer, comments integer, opened integer, joined integer, ended boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator'; end if;
  return query
  select p.id, p.kind, p.title, p.body, p.posted_as, e.full_name, p.created_at, p.published_at, p.deleted_at, d.full_name, p.meet_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null),
         (select count(distinct j.employee_id)::int from digest_joins j where j.post_id = p.id),
         digest_ended(p.kind, p.meet_at, p.meet_minutes, p.show_until, p.apply_by, p.closes_at)
  from digest_posts p left join employees e on e.id = p.posted_by left join employees d on d.id = p.deleted_by
  order by p.created_at desc
  limit 1000;
end $function$;

revoke all on function public.digest_sw_list() from public, anon;
grant execute on function public.digest_sw_list() to authenticated;
