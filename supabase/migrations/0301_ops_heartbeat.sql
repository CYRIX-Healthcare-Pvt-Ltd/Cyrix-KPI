-- =====================================================================
-- Cyrix KPI  ·  0301  ·  ops_heartbeat(): one number for the outside pinger
--
-- app.cyrix.in/api/heartbeat (platform, 19 Nov 2026) is called by an
-- outside uptime pinger with no session, so the Ops alerts still work
-- when the database they live in is in trouble. It needs exactly one
-- fact: how long ago the 5-minute uptime round last stored a check.
--
-- This returns that, in whole seconds, and nothing else. Callable by
-- anon on purpose: the portal then needs no service key at all (it holds
-- only the public anon key, as /api/ops does). The number reveals no
-- person, app or result.
-- =====================================================================

create or replace function public.ops_heartbeat()
returns integer
language sql security definer stable
set search_path = public
as $$
  select coalesce(extract(epoch from now() - max(at))::int, -1) from ops_check where at > now() - interval '1 day'
$$;

revoke all on function public.ops_heartbeat() from public;
grant execute on function public.ops_heartbeat() to anon, authenticated;
