-- =====================================================================
-- Cyrix KPI  ·  0182  ·  Drafts, and the meeting link kept back
--
-- The user, 12 Oct: "meeting link also only to be visible before 15 mins";
-- "in creating new or edit we need draft, publish and preview, so if clicked
-- draft, it should be saved but not to be sent to users".
--
-- published_at: when a post went out; null is a draft, seen by nobody but the
-- desk that wrote it, never notified, never reminded. digest_set_published
-- publishes or takes back to draft. The feed gives a meeting's link only from
-- 15 minutes before it starts (has_link says there is one), and Join refuses
-- before then.
-- =====================================================================

alter table digest_posts add column if not exists published_at timestamptz;
update digest_posts set published_at = created_at where published_at is null;
-- Published unless saved as a draft: a page that does not know about drafts still publishes.
alter table digest_posts alter column published_at set default now();

create or replace function digest_set_published(p_id uuid, p_published boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update digest_posts
  set published_at = case when p_published then coalesce(published_at, now()) end
  where id = p_id and deleted_at is null and posted_as = digest_can_post();
  if not found then raise exception 'Only whoever posted it can publish it'; end if;
end $$;
revoke all on function digest_set_published(uuid, boolean) from public, anon;
grant execute on function digest_set_published(uuid, boolean) to authenticated;

drop function if exists digest_feed(int, timestamptz);
CREATE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, liked boolean, comments integer, vac_location text, apply_by date, apply_link text, has_link boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.kind, p.title, p.body, p.image_url, p.color,
         p.meet_at, p.meet_minutes,
         -- The link itself only from 15 minutes before the start (0182); has_link says one is set.
         case when p.meet_at - interval '15 minutes' <= now() then p.meet_link end,
         p.meet_place,
         p.posted_as, e.full_name, p.published_at,
         (select count(*)::int from digest_likes l where l.post_id = p.id),
         exists (select 1 from digest_likes l where l.post_id = p.id and l.employee_id = current_employee_id()),
         (select count(*)::int from digest_comments c where c.post_id = p.id and c.deleted_at is null),
         p.vac_location, p.apply_by, p.apply_link,
         p.meet_link is not null
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
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, comments integer, joined integer, clicks integer, mine boolean, vac_location text, apply_by date, apply_link text, show_until date, published_at timestamp with time zone)
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
         p.published_at
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and p.posted_as = desk
  order by p.created_at desc
  limit 500;
end $function$;
grant execute on function digest_admin_list() to authenticated;

CREATE OR REPLACE FUNCTION public.digest_meetings_due()
 RETURNS TABLE(id uuid, title text, meet_at timestamp with time zone, meet_place text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.title, p.meet_at, p.meet_place from digest_posts p
  where p.kind = 'meeting' and p.deleted_at is null and p.published_at is not null
    and p.meet_at between now() + interval '9 minutes' and now() + interval '16 minutes'
    and not exists (select 1 from push_messages m where m.dedupe_key = 'digest-reminder:' || p.id)
$function$;

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
  if (select meet_at from digest_posts where id = p_id) - interval '15 minutes' > now() then
    raise exception 'Join opens 15 minutes before the meeting';
  end if;
  insert into digest_joins (post_id, employee_id) values (p_id, me);
  return link;
end $function$;
