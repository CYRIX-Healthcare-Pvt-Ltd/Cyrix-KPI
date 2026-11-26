-- 0242 · Cyrix Digest: Send to — everyone, or chosen people
-- The user, 2 Nov: "option to send it to custom peoples, like select function, reportees, ecode or name (multiple
-- ecode or name and upload excel only ecode also) it should be very user friendly"; "send to mandatory, default as
-- all". A post keeps what was chosen (audience) and who that came to when saved (audience_ids); none is everyone.
-- Its feed, its notification, its meeting reminders and its people count follow audience_ids.

drop function if exists public.digest_audience_count(text[], text[], text[]);
drop function if exists public.digest_set_audience(uuid, text[], text[], text[]);
drop function if exists public.digest_audience_resolve(text[], text[], text[]);

alter table public.digest_posts
  add column if not exists audience jsonb,
  add column if not exists audience_ids uuid[];

-- Who the choice reaches: a manager's direct reportees, the functions' people, everyone under a manager (Team of,
-- all levels), and the E-codes (the user, 2 Nov: "direct reportees, function, team of and people, then upload").
create or replace function public.digest_audience_resolve(p_functions text[], p_managers text[], p_ecodes text[], p_direct text[] default null)
returns uuid[]
language sql stable security definer set search_path to 'public'
as $function$
  with recursive team as (
    select e.id from employees e join employees m on m.id = e.reporting_manager_id
    where m.is_active and upper(m.ecode) = any (select upper(btrim(x)) from unnest(coalesce(p_managers, '{}')) x)
    union
    select e.id from employees e join team t on e.reporting_manager_id = t.id
  )
  select coalesce(array_agg(distinct e.id), '{}') from employees e
  -- A function or a team is its employees; an E-code typed or uploaded is that person, test accounts too.
  where e.is_active
    and ((e.account_type = 'employee' and (e.function_name = any (coalesce(p_functions, '{}')) or e.id in (select id from team)
           or e.reporting_manager_id in (select m.id from employees m where upper(m.ecode) = any (select upper(btrim(x)) from unnest(coalesce(p_direct, '{}')) x))))
         -- The manager chosen is in their own team too (the user, 2 Nov: "it does include him also isnt?").
         or upper(e.ecode) = any (select upper(btrim(x)) from unnest(coalesce(p_ecodes, '{}') || coalesce(p_managers, '{}') || coalesce(p_direct, '{}')) x))
$function$;
revoke all on function public.digest_audience_resolve(text[], text[], text[], text[]) from public, anon, authenticated;

-- How many the choice reaches, while it is being made.
create or replace function public.digest_audience_count(p_functions text[], p_managers text[], p_ecodes text[], p_direct text[] default null)
returns integer
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return cardinality(digest_audience_resolve(p_functions, p_managers, p_ecodes, p_direct));
end $function$;

-- The functions and the managers to choose from, each with how many it reaches.
create or replace function public.digest_audience_options()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if digest_can_post() is null then raise exception 'Only HR, IT or Marketing'; end if;
  return jsonb_build_object(
    'functions', (select coalesce(jsonb_agg(jsonb_build_object('name', f, 'n', n) order by f), '[]'::jsonb) from (
      select e.function_name f, count(*) n from employees e
      where e.is_active and e.account_type = 'employee' and nullif(btrim(e.function_name), '') is not null
      group by e.function_name) x),
    'managers', (select coalesce(jsonb_agg(jsonb_build_object('ecode', m.ecode, 'name', m.full_name, 'n', n + 1, 'fns', fns) order by m.full_name), '[]'::jsonb) from (
      -- With their team's functions: a function chosen narrows the managers to its own (the user, 2 Nov).
      select m.ecode, m.full_name, count(*) n, array_agg(distinct e.function_name) filter (where e.function_name is not null) fns from employees m join employees e on e.reporting_manager_id = m.id
      where m.is_active and e.is_active and e.account_type = 'employee'
      group by m.ecode, m.full_name) m));
end $function$;

-- Saving the choice: none of the three is everyone.
create or replace function public.digest_set_audience(p_id uuid, p_functions text[], p_managers text[], p_ecodes text[], p_direct text[] default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  everyone boolean := coalesce(cardinality(p_functions), 0) + coalesce(cardinality(p_managers), 0) + coalesce(cardinality(p_ecodes), 0) + coalesce(cardinality(p_direct), 0) = 0;
  ids uuid[];
begin
  if not exists (select 1 from digest_posts where id = p_id and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted it can choose who it goes to';
  end if;
  if not everyone then
    ids := digest_audience_resolve(p_functions, p_managers, p_ecodes, p_direct);
    if cardinality(ids) = 0 then raise exception 'Nobody is in that choice — choose again'; end if;
  end if;
  update digest_posts
     set audience = case when everyone then null else jsonb_build_object(
           'functions', to_jsonb(coalesce(p_functions, '{}')), 'managers', to_jsonb(coalesce(p_managers, '{}')),
           'ecodes', to_jsonb(coalesce(p_ecodes, '{}')), 'direct', to_jsonb(coalesce(p_direct, '{}'))) end,
         audience_ids = case when everyone then null else ids end
   where id = p_id;
  return coalesce(cardinality(ids), 0);
end $function$;

-- What a post was sent to, for editing it.
create or replace function public.digest_audience(p_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select p.audience from digest_posts p where p.id = p_id and (digest_can_edit(p.id) or is_sw_admin())
$function$;

revoke all on function public.digest_audience_count(text[], text[], text[], text[]) from public, anon;
revoke all on function public.digest_audience_options() from public, anon;
revoke all on function public.digest_set_audience(uuid, text[], text[], text[], text[]) from public, anon;
revoke all on function public.digest_audience(uuid) from public, anon;
grant execute on function public.digest_audience_count(text[], text[], text[], text[]) to authenticated;
grant execute on function public.digest_audience_options() to authenticated;
grant execute on function public.digest_set_audience(uuid, text[], text[], text[], text[]) to authenticated;
grant execute on function public.digest_audience(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.digest_feed(p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, title text, body text, image_url text, color text, meet_at timestamp with time zone, meet_minutes integer, meet_link text, meet_place text, posted_as text, author text, created_at timestamp with time zone, likes integer, liked boolean, comments integer, vac_location text, apply_by date, apply_link text, has_link boolean, join_early integer, video_id text, is_test boolean, pdf_url text, pdf_name text)
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
         p.published_at is null,
         p.pdf_url, p.pdf_name
  from digest_posts p left join employees e on e.id = p.posted_by
  where p.deleted_at is null and current_employee_id() is not null
    -- Published only: a draft is the posting desk's alone (0182).
    -- A test of a draft (0187) reaches only the people it was sent to.
    and (p.published_at is not null or current_employee_id() = any (p.testers))
    -- Sent to chosen people (0242): theirs, and the posting desk's.
    and (p.audience_ids is null or current_employee_id() = any (p.audience_ids) or digest_can_edit(p.id))
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

CREATE OR REPLACE FUNCTION public.digest_post_people(p_id uuid)
 RETURNS TABLE(ecode text, full_name text, department text, function_name text, seen_at timestamp with time zone, opened_at timestamp with time zone, opens integer, liked_at timestamp with time zone, comments integer, joins integer, joined_at timestamp with time zone, voted text, answered_at timestamp with time zone, answers jsonb, watched_seconds integer, video_seconds integer, watched_at timestamp with time zone, last_opened timestamp with time zone, last_joined timestamp with time zone, manager_name text, manager_ecode text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query
  select e.ecode, e.full_name, e.department, e.function_name,
         v.seen_at, v.opened_at, coalesce(v.opens, 0),
         l.created_at,
         (select count(*)::int from digest_comments c where c.post_id = p_id and c.employee_id = e.id and c.deleted_at is null),
         (select count(*)::int from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select min(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         (select string_agg(o.label, ', ' order by o.position) from digest_votes dv join digest_poll_options o on o.id = dv.option_id where dv.post_id = p_id and dv.employee_id = e.id),
         fr.updated_at, fr.answers,
         vw.watched_seconds, vw.duration_seconds, vw.started_at, v.last_opened,
         (select max(j.clicked_at) from digest_joins j where j.post_id = p_id and j.employee_id = e.id),
         mg.full_name, mg.ecode
  from employees e
  left join employees mg on mg.id = e.reporting_manager_id
  left join digest_views v on v.post_id = p_id and v.employee_id = e.id
  left join digest_likes l on l.post_id = p_id and l.employee_id = e.id
  left join digest_form_responses fr on fr.post_id = p_id and fr.employee_id = e.id
  left join digest_video_views vw on vw.post_id = p_id and vw.employee_id = e.id
  where e.is_active and e.account_type = 'employee'
    -- Sent to chosen people (0242): out of them.
    and coalesce(e.id = any ((select a.audience_ids from digest_posts a where a.id = p_id)), true)
  order by e.full_name;
end $function$;
