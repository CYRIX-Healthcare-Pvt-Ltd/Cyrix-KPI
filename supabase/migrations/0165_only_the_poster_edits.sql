-- =====================================================================
-- Cyrix KPI  ·  0165  ·  Only whoever posted it edits or deletes it
--
-- The user, 10 Oct: "the one who posted should have edit and delete
-- options". HR, IT and Marketing each post as one shared login, so the
-- desk is the poster: a post is changed or removed only by the desk that
-- posted it (posted_as). The admin list says which are yours (mine).
-- Newest first, as before.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.digest_save(p_id uuid, p_kind text, p_title text, p_body text, p_image_url text, p_color text, p_meet_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meet_minutes integer DEFAULT NULL::integer, p_meet_link text DEFAULT NULL::text, p_meet_place text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  desk text := digest_can_post();
  v    uuid;
begin
  if desk is null then raise exception 'Only HR, IT or Marketing can post to Cyrix Digest'; end if;
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
    where id = p_id and deleted_at is null and posted_as = desk
    returning id into v;
    if v is null then raise exception 'Only whoever posted it can change it'; end if;
  end if;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.digest_remove(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing can remove a post'; end if;
  update digest_posts set deleted_at = now() where id = p_id and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted it can delete it'; end if;
end $function$
;

drop function if exists public.digest_admin_list();
create function public.digest_admin_list()
returns table (id uuid, kind text, title text, body text, image_url text, color text,
               meet_at timestamptz, meet_minutes int, meet_link text, meet_place text,
               posted_as text, author text, created_at timestamptz,
               likes int, comments int, joined int, clicks int, mine boolean)
language plpgsql stable security definer set search_path = public as $$
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
  where p.deleted_at is null
  order by p.created_at desc
  limit 500;
end $$;
grant execute on function public.digest_admin_list() to authenticated;
