-- =====================================================================
-- Cyrix KPI  ·  0303  ·  Who is on the platform right now, and when it is quiet
--
-- Adrian (20 Nov 2026): show the current active users on the Ops page, and
-- plan a maintenance-mode SOP so backend work does not hit people who are
-- mid-task. Both need the same fact: how many people have the platform open,
-- now and at each hour of the day.
--
-- "Active" here = a signed-in session that refreshed its token recently.
-- A browser with any Cyrix app open refreshes about once an hour (the JWT
-- lives 60 minutes), so:
--   users_60  sessions refreshed in the last 60 minutes = has an app open now
--   users_15  refreshed in the last 15 minutes          = a subset, just arrived
-- It counts people, not tabs, and no names leave the database.
--
--   ops_active          one row every 5 minutes (cron ops-active), kept 90 days
--   ops_sample_active() writes that row
--   ops_active_now()    for the page: the live counts, the last 24 hours, and the
--                       average and peak per IST hour over 14 days, which is the
--                       chart a maintenance window is picked from. Ops admins only.
-- =====================================================================

create table if not exists ops_active (
  at        timestamptz primary key,
  users_60  int not null,
  users_15  int not null
);
-- RLS on and no policy: only the definer functions below read or write it.
alter table ops_active enable row level security;

create or replace function public.ops_sample_active()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  insert into ops_active (at, users_60, users_15)
  select date_trunc('minute', now()),
         count(distinct user_id) filter (where coalesce(refreshed_at, updated_at, created_at) > now() - interval '60 minutes'),
         count(distinct user_id) filter (where coalesce(refreshed_at, updated_at, created_at) > now() - interval '15 minutes')
  from auth.sessions
  where coalesce(refreshed_at, updated_at, created_at) > now() - interval '60 minutes'
  on conflict (at) do nothing;
  delete from ops_active where at < now() - interval '90 days';
end $$;

create or replace function public.ops_active_now()
returns jsonb
language plpgsql security definer stable
set search_path = public, auth
as $$
declare
  v_60 int; v_15 int;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  select count(distinct user_id) filter (where coalesce(refreshed_at, updated_at, created_at) > now() - interval '60 minutes'),
         count(distinct user_id) filter (where coalesce(refreshed_at, updated_at, created_at) > now() - interval '15 minutes')
    into v_60, v_15
  from auth.sessions
  where coalesce(refreshed_at, updated_at, created_at) > now() - interval '60 minutes';

  return jsonb_build_object(
    'at', now(),
    'users_60', v_60,
    'users_15', v_15,
    'first_sample', (select min(at) from ops_active),
    'last_24h', coalesce((
      select jsonb_agg(jsonb_build_array(at, users_60) order by at)
      from ops_active where at > now() - interval '24 hours'), '[]'::jsonb),
    -- Average and peak per IST hour of day over the last 14 days, weekdays and weekends apart:
    -- the quiet hours differ, and a Sunday-morning window is often the right one.
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'weekend', we, 'avg', round(a, 1), 'peak', p) order by we, h)
      from (
        select extract(hour from at at time zone 'Asia/Kolkata')::int as h,
               extract(isodow from at at time zone 'Asia/Kolkata') in (6, 7) as we,
               avg(users_60) as a, max(users_60) as p
        from ops_active where at > now() - interval '14 days'
        group by 1, 2) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.ops_sample_active() from public, anon, authenticated;
revoke all on function public.ops_active_now() from public, anon;
grant execute on function public.ops_active_now() to authenticated;

-- Offset from ops-round (:00, :05 ...) so the two never open a connection in the same second.
select cron.schedule('ops-active', '2-59/5 * * * *', 'select public.ops_sample_active()');

do $$
begin
  if has_function_privilege('anon', 'public.ops_active_now()', 'execute')
     or has_function_privilege('authenticated', 'public.ops_sample_active()', 'execute') then
    raise exception '0303: ops_active functions are too widely granted';
  end if;
end $$;
