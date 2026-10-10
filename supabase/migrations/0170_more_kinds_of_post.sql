-- =====================================================================
-- Cyrix KPI  ·  0170  ·  Announcement, alert, notice, vacancy
--
-- The user, 10 Oct: "can you add announcement, alerts, notice, vacancy".
-- Four more kinds of post, each like news — words, a picture, likes and
-- comments — with its own badge. An alert is shown first on the home page
-- for a week. A vacancy carries where, apply-by and how to apply (a link
-- or an email), set by digest_set_vacancy.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_kind_check;
alter table digest_posts add constraint digest_posts_kind_check
  check (kind in ('news', 'meeting', 'poll', 'announcement', 'alert', 'notice', 'vacancy'));
alter table digest_posts add column if not exists vac_location text;
alter table digest_posts add column if not exists apply_by date;
alter table digest_posts add column if not exists apply_link text;

create or replace function digest_set_vacancy(p_id uuid, p_location text, p_apply_by date, p_apply_link text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(p_apply_link, '')), '') is not null
     and btrim(p_apply_link) !~* '^(https://|mailto:)?[^\s]+$' then
    raise exception 'How to apply: a link starting with https:// or an email address';
  end if;
  update digest_posts
  set vac_location = nullif(btrim(coalesce(p_location, '')), ''),
      apply_by = p_apply_by,
      apply_link = nullif(btrim(coalesce(p_apply_link, '')), '')
  where id = p_id and kind = 'vacancy' and deleted_at is null and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted the vacancy can change it'; end if;
end $$;
grant execute on function digest_set_vacancy(uuid, text, date, text) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_toggle_like(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select kind from digest_posts where id = p_id and deleted_at is null) not in ('news', 'announcement', 'alert', 'notice', 'vacancy') then
    raise exception 'A meeting or a poll cannot be liked';
  end if;
  if exists (select 1 from digest_likes where post_id = p_id and employee_id = me) then
    delete from digest_likes where post_id = p_id and employee_id = me;
    return false;
  end if;
  insert into digest_likes (post_id, employee_id) values (p_id, me);
  return true;
end $function$
;

drop function if exists digest_feed(int, timestamptz);
CREATE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$
;
grant execute on function digest_feed(int, timestamptz) to authenticated;

drop function if exists digest_admin_list();
CREATE FUNCTION public.digest_admin_list()
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text)
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
         p.vac_location, p.apply_by, p.apply_link
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and p.posted_as = desk
  order by p.created_at desc
  limit 500;
end $function$
;
grant execute on function digest_admin_list() to authenticated;
