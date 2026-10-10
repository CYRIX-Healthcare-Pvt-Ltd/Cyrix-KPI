-- =====================================================================
-- Cyrix KPI  ·  0169  ·  Each desk sees its own posts
--
-- The user, 10 Oct: "they need to see their posted only in the admin
-- tab". HR, IT and Marketing each list, and read the numbers of, only
-- what they posted. Everybody still sees every post on the home page.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean)
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
         p.posted_as = desk
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and p.posted_as = desk
  order by p.created_at desc
  limit 500;
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and posted_as = digest_can_post()) then
    raise exception 'Only whoever posted it';
  end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_join_report(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, clicks integer, first_at timestamp with time zone, last_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and posted_as = digest_can_post()) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, e.department, count(*)::int, min(j.clicked_at), max(j.clicked_at)
  from digest_joins j join employees e on e.id = j.employee_id
  where j.post_id = p_id
  group by e.ecode, e.full_name, e.department
  order by min(j.clicked_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_likers(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and posted_as = digest_can_post()) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, l.created_at from digest_likes l join employees e on e.id = l.employee_id
  where l.post_id = p_id order by l.created_at;
end $function$
;
