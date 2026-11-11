-- =====================================================================
-- Cyrix KPI  ·  0281  ·  Telling every Rank 1 that their name is on the list
--
-- The user, 11 Nov: "push a notification to all rank 1 ... your name is in
-- the dashboard, please check and update your profile photo". One message
-- each, in their own names:
--   👑 Oct-26 Rank 1, Kevin!
--   You're Rank 1 in Saranya's team, and your name is on the Rank 1s list
--   on the portal home. Add your profile photo so it shows beside your name.
-- (with a photo: "...your name and photo are on the Rank 1s list on the
-- portal home. Open it to see.")
-- A press opens the portal with the profile card open (no photo) or the
-- Rank 1s list open (photo): /?r1=photo, /?r1=list. They also sit in the
-- KPI bell, so people without phone notifications see them.
-- Once a month per person (dedupe key). Only SW Admin sends, by calling
-- portal_tell_rank_ones() — nothing goes out when this file is applied.
-- =====================================================================

-- The portal's Rank 1 links belong to the KPI bell (0250 put '/' there already).
create or replace function message_app(p_url text)
returns text
language sql immutable as $$
  select case
    when coalesce(p_url, '') in ('', '/') or p_url like '/kpi%' or p_url like '/?r1=%' then 'kpi'
    when p_url like '/travel%' then 'travel'
  end
$$;

create or replace function public.portal_tell_rank_ones()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; mid uuid; n int := 0; me uuid := current_employee_id();
  mon text; first_name text; mgr_first text;
begin
  -- SW Admin from the app; a signed-in call by anybody else is refused (the database's own run has no employee).
  if me is not null and not is_sw_admin() then raise exception 'Only the software administrator can send this'; end if;
  for r in select o.*, e.id emp_id, (e.avatar is not null) has_photo
           from kpi_rank_ones() o join employees e on upper(e.ecode) = upper(o.ecode) and e.is_active loop
    mon := to_char(r.period_month, 'Mon') || '-' || to_char(r.period_month, 'YY');
    first_name := split_part(btrim(r.full_name), ' ', 1);
    mgr_first := split_part(btrim(r.manager_name), ' ', 1);
    -- A name kept in capitals reads as a word, not a shout: ABHIJEET → Abhijeet.
    if first_name = upper(first_name) then first_name := initcap(first_name); end if;
    if mgr_first = upper(mgr_first) then mgr_first := initcap(mgr_first); end if;
    insert into push_messages (kind, title, body, url, target, sent_by, people, dedupe_key)
    values ('module',
      '👑 ' || mon || ' Rank 1, ' || first_name || '!',
      case when r.has_photo
        then 'You''re Rank 1 in ' || mgr_first || '''s team, and your name and photo are on the Rank 1s list on the portal home. Open it to see.'
        else 'You''re Rank 1 in ' || mgr_first || '''s team, and your name is on the Rank 1s list on the portal home. Add your profile photo so it shows beside your name.'
      end,
      case when r.has_photo then '/?r1=list' else '/?r1=photo' end,
      jsonb_build_object('kind', 'rank1'), me, 1,
      'rank1:' || upper(r.ecode) || ':' || r.period_month)
    on conflict (dedupe_key) do nothing
    returning id into mid;
    if mid is not null then
      insert into push_inbox (message_id, employee_id) values (mid, r.emp_id);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform push_call('queued'); end if;
  return n;
end $$;
revoke all on function public.portal_tell_rank_ones() from public, anon;
grant execute on function public.portal_tell_rank_ones() to authenticated;
