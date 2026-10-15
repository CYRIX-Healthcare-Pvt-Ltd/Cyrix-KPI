-- A meeting-day reminder at 09:30 (the user, 15 Oct): "hey Kevin, today is the townhall meeting,
-- scheduled at 4 PM, please do join". Only for meetings posted before that day; one posted the
-- same day gets only the Join reminder. Read by the push function's 09:30 run; once per meeting.
create or replace function public.digest_meetings_today()
returns table(id uuid, title text, meet_at timestamptz, meet_place text)
language sql stable security definer set search_path to 'public' as $f$
  select p.id, p.title, p.meet_at, p.meet_place from digest_posts p
  where p.kind = 'meeting' and p.deleted_at is null and p.published_at is not null
    and (p.meet_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
    and (p.published_at at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date
    and p.meet_at > now()
    and not exists (select 1 from push_messages m where m.dedupe_key = 'digest-morning:' || p.id)
$f$;
revoke all on function public.digest_meetings_today() from public, anon, authenticated;
