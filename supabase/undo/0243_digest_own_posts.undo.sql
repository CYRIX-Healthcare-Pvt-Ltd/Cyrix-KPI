-- Undo 0243: the desk-wide Digest rules of 0183 back.
CREATE OR REPLACE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone, can_edit boolean, editors text[], opened integer, join_early integer, video_id text, pdf_url text, pdf_name text)
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
         p.join_early, p.video_id,
         p.pdf_url, p.pdf_name
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and (p.posted_as = desk or desk = any (p.editors))
  order by p.created_at desc
  limit 500;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_can_edit(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from digest_posts p
                 where p.id = p_id and p.deleted_at is null
                   and digest_can_post() is not null
                   and (p.posted_as = digest_can_post() or digest_can_post() = any (p.editors)))
$function$;

CREATE OR REPLACE FUNCTION public.digest_remove(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing can remove a post'; end if;
  update digest_posts set deleted_at = now(), deleted_by = current_employee_id() where id = p_id and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted it can delete it'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_set_editors(p_id uuid, p_desks text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare desk text := digest_can_post();
begin
  update digest_posts
  set editors = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(coalesce(p_desks, '{}')) d
                 where d in ('hr', 'it', 'mkt') and d <> desk)
  where id = p_id and deleted_at is null and posted_as = desk;
  if not found then raise exception 'Only the desk that posted it can share it'; end if;
end $function$;
drop function if exists digest_mine(uuid, text, text[]);
