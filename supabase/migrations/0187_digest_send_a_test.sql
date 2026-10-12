-- =====================================================================
-- Cyrix KPI  ·  0187  ·  Send a draft as a test to a few people
--
-- The user, 13 Oct: "when meeting, they want to test the link, whether it is
-- opening or not, so can we have a test option, they can select the
-- participants entering name or ecode, so that they can check how it will
-- look, link working".
--
-- testers: the people a draft was sent to as a test. They see it on their
-- home page marked Test, and for them a meeting's Join works at once. Their
-- opens and joins are not counted. Publishing clears the list.
-- =====================================================================

alter table digest_posts add column if not exists testers uuid[] not null default '{}';

-- Everybody to choose from, by name and E-code, for the Digest desks; one value, so not cut at 1,000 rows.
create or replace function digest_people_options()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]'::jsonb)
          from employees e where e.is_active and position('_' in e.ecode) = 0);
end $$;
revoke all on function digest_people_options() from public, anon;
grant execute on function digest_people_options() to authenticated;

-- A draft goes to these people as a test; the poster's own desk may always see it in its list.
create or replace function digest_set_testers(p_id uuid, p_ecodes text[])
returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if not exists (select 1 from digest_posts where id = p_id and published_at is null and digest_can_edit(id)) then
    raise exception 'Only a draft can be sent as a test, by a desk that can edit it';
  end if;
  select coalesce(array_agg(distinct e.id), '{}') into ids
  from employees e where e.is_active and upper(e.ecode) = any (select upper(btrim(x)) from unnest(coalesce(p_ecodes, '{}')) x);
  if cardinality(ids) = 0 then raise exception 'Choose who gets the test'; end if;
  if cardinality(ids) > 50 then raise exception 'A test goes to 50 people at most'; end if;
  update digest_posts set testers = ids where id = p_id;
  return cardinality(ids);
end $$;
revoke all on function digest_set_testers(uuid, text[]) from public, anon;
grant execute on function digest_set_testers(uuid, text[]) to authenticated;

drop function if exists digest_feed(int, timestamptz);
CREATE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
    and coalesce(digest_last_day(p.kind, p.show_until, p.apply_by, p.closes_at), 'infinity'::date)
        >= (now() at time zone 'Asia/Kolkata')::date
    -- A meeting, once it is over (0179).
    and (p.kind <> 'meeting' or p.meet_at is null
         or p.meet_at + make_interval(mins => coalesce(p.meet_minutes, 60)) > now())
  order by p.published_at is null desc, coalesce(p.published_at, p.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$function$;
grant execute on function digest_feed(int, timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_join(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); link text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select meet_link into link from digest_posts where id = p_id and kind = 'meeting' and deleted_at is null
    and (published_at is not null or me = any (testers));
  if link is null then raise exception 'The meeting link has not been shared yet'; end if;
  -- Not before 15 minutes ahead of the start (0182).
  -- A test opens at once, and is not counted (0187).
  if (select published_at is null from digest_posts where id = p_id) then return link; end if;
  if (select meet_at - make_interval(mins => join_early) from digest_posts where id = p_id) > now() then
    raise exception 'Join opens % minutes before the meeting', (select join_early from digest_posts where id = p_id);
  end if;
  insert into digest_joins (post_id, employee_id) values (p_id, me);
  return link;
end $function$;

CREATE OR REPLACE FUNCTION public.digest_opened(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into digest_views (post_id, employee_id, opened_at, last_opened, opens)
  select p_id, current_employee_id(), now(), now(), 1
  where current_employee_id() is not null and exists (select 1 from digest_posts where id = p_id and deleted_at is null and published_at is not null)
  on conflict (post_id, employee_id) do update
    set opened_at = coalesce(digest_views.opened_at, now()), last_opened = now(), opens = digest_views.opens + 1
$function$;

CREATE OR REPLACE FUNCTION public.digest_seen(p_ids uuid[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into digest_views (post_id, employee_id)
  select p.id, current_employee_id() from digest_posts p
  where p.id = any (p_ids) and p.deleted_at is null and p.published_at is not null and current_employee_id() is not null
  on conflict do nothing
$function$;

CREATE OR REPLACE FUNCTION public.digest_set_published(p_id uuid, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update digest_posts
  set published_at = case when p_published then coalesce(published_at, now()) end,
      testers = case when p_published then '{}' else testers end
  where id = p_id and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted it can publish it'; end if;
end $function$;
