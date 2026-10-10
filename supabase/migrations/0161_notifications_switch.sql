-- =====================================================================
-- Cyrix KPI  ·  0161  ·  One switch for all of it
--
-- The user, 10 Oct: "for SW Admin a notification on/off toggle; off, HR's
-- tab goes; if any glitch happens SW Admin should be able to disable it".
-- app_settings.push_enabled. Off: the push function sends nothing — no
-- message, no bell, no reminder — HR's Notify tab is gone, and nobody is
-- asked to turn notifications on. On again, it carries on.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('push_enabled', 'true'::jsonb, 'Notifications on phones and desktops, and messages from HR and SW Admin (0154–0161). SW Admin switches it off if anything goes wrong.')
on conflict (key) do nothing;

create or replace function set_push_enabled(p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin can switch notifications on or off'; end if;
  update app_settings set value = to_jsonb(coalesce(p_on, false)), updated_at = now() where key = 'push_enabled';
  perform log_audit('app_settings', null, case when p_on then 'push_on' else 'push_off' end, '{}'::jsonb);
end $$;
grant execute on function set_push_enabled(boolean) to authenticated;

create or replace function push_is_enabled()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'push_enabled'), true)
$$;
grant execute on function push_is_enabled() to authenticated, service_role;
