-- Installed app and notifications, per person, on SW Admin's Logins tab (the user, 15 Oct).
-- The installed app says so each time it opens (note_installed); notifications are on where
-- push_subscriptions holds a device. Read as one value, past PostgREST's 1,000 rows.
create table if not exists public.app_installs (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  platform text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.app_installs enable row level security;
revoke all on public.app_installs from anon, authenticated;

create or replace function public.note_installed(p_platform text)
returns void language sql security definer set search_path to 'public' as $f$
  insert into app_installs (employee_id, platform) select current_employee_id(), left(p_platform, 40)
  where current_employee_id() is not null
  on conflict (employee_id) do update set last_seen_at = now(), platform = excluded.platform
$f$;
revoke all on function public.note_installed(text) from public, anon;
grant execute on function public.note_installed(text) to authenticated;

create or replace function public.app_status_ids()
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select case when is_sw_admin() or is_hr_admin() then jsonb_build_object(
    'installed', (select coalesce(jsonb_agg(employee_id), '[]') from app_installs),
    'push', (select coalesce(jsonb_agg(distinct employee_id), '[]') from push_subscriptions where coalesce(failures, 0) < 3))
  end
$f$;
revoke all on function public.app_status_ids() from public, anon;
grant execute on function public.app_status_ids() to authenticated;
