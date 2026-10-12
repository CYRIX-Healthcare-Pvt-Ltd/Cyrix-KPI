-- =====================================================================
-- Cyrix KPI  ·  0184  ·  How many opened each post, in the list
--
-- The user, 12 Oct: "show opened count also", beside the comments and the
-- Join clicks on each post in the Digest list.
-- =====================================================================

drop function if exists digest_admin_list();
CREATE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone, can_edit boolean, editors text[], opened integer)
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
         (select count(*)::int from digest_views v where v.post_id = p.id and v.opened_at is not null)
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and (p.posted_as = desk or desk = any (p.editors))
  order by p.created_at desc
  limit 500;
end $function$;
grant execute on function digest_admin_list() to authenticated;
