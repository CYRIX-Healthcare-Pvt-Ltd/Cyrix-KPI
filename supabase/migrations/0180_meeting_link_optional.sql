-- =====================================================================
-- Cyrix KPI  ·  0180  ·  A meeting can be announced before its link
--
-- The user, 12 Oct: "link will not be received now, so need a checkbox
-- meeting link". A meeting needs its date and time; the link is optional,
-- and when given starts with https://. People see "Meeting link will be
-- shared soon" until it comes, and adding it tells everybody.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_check;
alter table digest_posts add constraint digest_posts_meeting_check
  check (kind <> 'meeting' or (meet_at is not null and (meet_link is null or meet_link ~ '^https://')));

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
  if p_kind = 'meeting' and p_meet_at is null then
    raise exception 'A meeting needs a date and time';
  end if;
  if p_kind = 'meeting' and nullif(btrim(coalesce(p_meet_link, '')), '') is not null and btrim(p_meet_link) !~ '^https://' then
    raise exception 'The meeting link starts with https://';
  end if;
  if p_id is null then
    insert into digest_posts (kind, title, body, image_url, color, meet_at, meet_minutes, meet_link, meet_place, posted_by, posted_as)
    values (p_kind, btrim(p_title), coalesce(p_body, ''), nullif(p_image_url, ''), coalesce(p_color, 'red'),
            case when p_kind = 'meeting' then p_meet_at end, case when p_kind = 'meeting' then p_meet_minutes end,
            case when p_kind = 'meeting' then nullif(btrim(p_meet_link), '') end, case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
            current_employee_id(), desk)
    returning id into v;
  else
    update digest_posts set kind = p_kind, title = btrim(p_title), body = coalesce(p_body, ''),
      image_url = nullif(p_image_url, ''), color = coalesce(p_color, 'red'),
      meet_at = case when p_kind = 'meeting' then p_meet_at end,
      meet_minutes = case when p_kind = 'meeting' then p_meet_minutes end,
      meet_link = case when p_kind = 'meeting' then nullif(btrim(p_meet_link), '') end,
      meet_place = case when p_kind = 'meeting' then nullif(btrim(p_meet_place), '') end,
      updated_at = now()
    where id = p_id and deleted_at is null and posted_as = desk
    returning id into v;
    if v is null then raise exception 'Only whoever posted it can change it'; end if;
  end if;
  return v;
end $function$;
