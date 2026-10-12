-- =====================================================================
-- Cyrix KPI  ·  0178  ·  A poll and a vacancy end on their own dates
--
-- The user, 12 Oct: "in poll already we have closes field and in vacancy
-- apply by is there so for that show until not needed". A vacancy leaves
-- the portal home after its Apply by day, a poll after the day it closes;
-- Show until is for the other kinds. digest_admin_list's show_until is now
-- the day a post ends, whichever date gives it.
-- =====================================================================

create or replace function digest_last_day(p_kind text, p_show_until date, p_apply_by date, p_closes_at timestamptz)
returns date
language sql immutable as $$
  select case p_kind
           when 'vacancy' then p_apply_by
           when 'poll' then (p_closes_at at time zone 'Asia/Kolkata')::date
           else p_show_until
         end
$$;

CREATE OR REPLACE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, liked boolean, comments integer, vac_location text, apply_by date, apply_link text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.kind, p.title, p.body, p.image_url, p.color,
         p.meet_at, p.meet_minutes, p.meet_link, p.meet_place,
         p.posted_as, e.full_name, p.created_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         exists (select 1 from digest_likes l where l.post_id = p.id and l.employee_id = current_employee_id()),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         p.vac_location, p.apply_by, p.apply_link
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and current_employee_id() is not null
    and (p_before is null or p.created_at < p_before)
    -- Shown until its last day, when it has one: Show until (0177), and for a
    -- vacancy its Apply by, for a poll the day it closes (0178).
    and coalesce(digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at), 'infinity'::date)
        >= (now() at time zone 'Asia/Kolkata')::date
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$;

CREATE OR REPLACE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date)
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
         p.vac_location, p.apply_by, p.apply_link, digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at)
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and p.posted_as = desk
  order by p.created_at desc
  limit 500;
end $function$;
