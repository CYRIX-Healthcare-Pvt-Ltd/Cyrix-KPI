-- =====================================================================
-- Cyrix KPI  ·  0177  ·  Cyrix Digest: an end date for any post
--
-- The user, 12 Oct: "for every post, end date also needed, ie i can set
-- till which date this post should be there, it is optional field".
-- show_until: the last day a post is on the portal home (Indian time).
-- Empty means it stays. The posting desk still sees it in its own list.
-- =====================================================================

alter table digest_posts add column if not exists show_until date;

create or replace function digest_set_until(p_id uuid, p_until date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update digest_posts set show_until = p_until
  where id = p_id and deleted_at is null and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted it can change it'; end if;
end $$;
revoke all on function digest_set_until(uuid, date) from public, anon;
grant execute on function digest_set_until(uuid, date) to authenticated;

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
    -- Shown until its end date, when it has one (0177).
    and (p.show_until is null or p.show_until >= (now() at time zone 'Asia/Kolkata')::date)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$;

drop function if exists digest_admin_list();
CREATE FUNCTION public.digest_admin_list()
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
         p.vac_location, p.apply_by, p.apply_link, p.show_until
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and p.posted_as = desk
  order by p.created_at desc
  limit 500;
end $function$;
grant execute on function digest_admin_list() to authenticated;
