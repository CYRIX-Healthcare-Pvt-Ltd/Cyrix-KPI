-- "Anytime" for Join (the user, 15 Oct): the link shows from the moment the meeting is posted.
-- Stored as join_early = 525600 (a year), so the feed and digest_join need no change. The
-- "starting soon" reminder, which goes when Join opens, stays at 15 minutes before for these.
CREATE OR REPLACE FUNCTION public.digest_meetings_due()
 RETURNS TABLE(id uuid, title text, meet_at timestamp with time zone, meet_place text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.title, p.meet_at, p.meet_place from digest_posts p
  where p.kind = 'meeting' and p.deleted_at is null and p.published_at is not null
    -- When Join opens (0185): 15 minutes before by default, or the post's own choice.
    and p.meet_at between now() + make_interval(mins => greatest((case when p.join_early >= 525600 then 15 else p.join_early end) - 6, 0)) and now() + make_interval(mins => (case when p.join_early >= 525600 then 15 else p.join_early end) + 1)
    and not exists (select 1 from push_messages m where m.dedupe_key = 'digest-reminder:' || p.id)
$function$;

