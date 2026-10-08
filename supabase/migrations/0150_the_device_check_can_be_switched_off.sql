-- =====================================================================
-- Cyrix KPI · 0150 · The device check can be switched off, per person
--
-- The user, 8 Oct: "add a auth check box ie for the multi device security,
-- bcz for some id for testing im sharing so that i can disable it, only
-- for sw_admin can change it". On for everybody unless SW_ADMIN unticks it
-- on the Logins tab; unticked, a second device signs in with no code.
-- =====================================================================

create table if not exists public.device_check_off (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  set_by      uuid references public.employees(id) on delete set null,
  set_at      timestamptz not null default now()
);
alter table public.device_check_off enable row level security;
revoke all on public.device_check_off from anon, authenticated;

create or replace function public.device_check()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  uid    uuid := auth.uid();
  sid    uuid := session_id_now();
  others integer;
  since  timestamptz := (select (value #>> '{}')::timestamptz from app_settings where key = 'device_check_since');
  made   timestamptz;
  email  text;
begin
  if uid is null or sid is null then raise exception 'Please sign in again'; end if;
  select created_at into made from auth.sessions where id = sid;
  if made is null then return jsonb_build_object('state', 'revoked'); end if;
  -- Switched off for this person by SW_ADMIN (0150): any device, no code.
  if exists (select 1 from device_check_off o join employees e on e.id = o.employee_id where e.auth_user_id = uid) then
    insert into device_sessions (session_id, user_id, how) values (sid, uid, 'only_device') on conflict do nothing;
    return jsonb_build_object('state', 'ok');
  end if;
  if exists (select 1 from device_sessions where session_id = sid) or made < since then
    return jsonb_build_object('state', 'ok');
  end if;
  select count(*) into others from auth.sessions
   where user_id = uid and id <> sid and (not_after is null or not_after > now());
  if others = 0 then
    insert into device_sessions (session_id, user_id, how) values (sid, uid, 'only_device') on conflict do nothing;
    return jsonb_build_object('state', 'ok');
  end if;
  select nullif(btrim(work_email), '') into email from employees where auth_user_id = uid;
  return jsonb_build_object(
    'state', 'pending', 'others', others,
    -- k****@cyrix.in: enough to know where to look, not the address itself.
    'email_hint', case when email is null then null
                       else left(email, 1) || '****' || substr(email, position('@' in email)) end);
end $function$;

create or replace function public.my_session_state()
returns text
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $function$
declare
  sid   uuid := session_id_now();
  made  timestamptz;
  since timestamptz := (select (value #>> '{}')::timestamptz from app_settings where key = 'device_check_since');
begin
  if sid is null then return 'revoked'; end if;
  select created_at into made from auth.sessions where id = sid;
  if made is null then return 'revoked'; end if;
  if made < since or exists (select 1 from device_sessions where session_id = sid) then return 'ok'; end if;
  if exists (select 1 from device_check_off o join employees e on e.id = o.employee_id where e.auth_user_id = auth.uid()) then return 'ok'; end if;
  return 'pending';
end $function$;

create or replace function public.device_check_off_list()
returns setof uuid language sql stable security definer set search_path to 'public' as $f$
  select employee_id from device_check_off where is_sw_admin()
$f$;
revoke execute on function public.device_check_off_list() from public, anon;
grant execute on function public.device_check_off_list() to authenticated;

create or replace function public.set_device_check(p_employee_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can switch the device check';
  end if;
  if p_on then
    delete from device_check_off where employee_id = p_employee_id;
  else
    insert into device_check_off (employee_id, set_by) values (p_employee_id, current_employee_id())
    on conflict (employee_id) do update set set_by = excluded.set_by, set_at = now();
  end if;
  perform log_audit('employee', p_employee_id, case when p_on then 'device_check_on' else 'device_check_off' end, '{}'::jsonb);
end $f$;
revoke execute on function public.set_device_check(uuid, boolean) from public, anon;
grant execute on function public.set_device_check(uuid, boolean) to authenticated;
