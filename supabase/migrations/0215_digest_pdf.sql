-- 0215: a file (PDF, Word, Excel...) on any Cyrix Digest post (the user, 17 Oct). Columns keep the pdf_ name.
-- The file is in the public digest bucket; its links stay live when it opens in the browser's viewer.
alter table digest_posts add column if not exists pdf_url text;
alter table digest_posts add column if not exists pdf_name text;

create or replace function public.digest_set_pdf(p_id uuid, p_url text, p_name text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update digest_posts set pdf_url = nullif(p_url, ''), pdf_name = case when coalesce(p_url, '') = '' then null else left(nullif(p_name, ''), 200) end
  where id = p_id and digest_can_edit(id);
  if not found then raise exception 'Only the desks that can edit it'; end if;
end $function$;
grant execute on function public.digest_set_pdf(uuid, text, text) to authenticated;

-- The feed and the desks' list carry it (new columns, so dropped and made again).
drop function if exists public.digest_feed(integer, timestamptz);
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
$function$
;
grant execute on function public.digest_feed(integer, timestamptz) to authenticated;

drop function if exists public.digest_admin_list();
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
end $function$
;
grant execute on function public.digest_admin_list() to authenticated;
