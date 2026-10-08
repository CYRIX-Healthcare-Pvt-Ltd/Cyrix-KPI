-- =====================================================================
-- Cyrix KPI · 0149 · A second device asks for a code
--
-- The user, 8 Oct: "first login ok, on 2nd login on any other device, it
-- should show that already signed in 1 device, send otp to mail, so 2
-- buttons needed login and signout from all device and login … when otp
-- is entered only these button only should enabled". With no email on
-- record, it stops and sends them to IT (it_support@cyrix.in) or HR; other
-- devices signed out are thrown out within a minute (each app asks
-- my_session_state).
--
--   device_check()        the portal, after signing in: ok, or pending
--                         with how many other devices and where the code
--                         goes. A session with no other device is ok at
--                         once; so is any session from before this.
--   my_session_state()    every app, each minute: ok, pending or revoked.
--   confirm_device_session  the password-otp function only, once the code
--                         is right: this session is ok, and with sign out
--                         from all, every other session is ended.
-- =====================================================================

alter table public.password_otp drop constraint password_otp_purpose_check;
alter table public.password_otp add constraint password_otp_purpose_check
  check (purpose = any (array['change', 'reset', 'device']));

-- A device code goes to the address on record; nobody types one.
create or replace function public.issue_password_otp(p_ecode text, p_email text, p_purpose text, p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  emp        employees%rowtype;
  recent     integer;
  ttl        constant interval := interval '10 minutes';
  window_    constant interval := interval '15 minutes';
  per_window constant integer  := 3;
begin
  delete from password_otp where created_at < now() - interval '24 hours';

  select * into emp from employees
  where upper(ecode) = upper(trim(p_ecode)) and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_employee');
  end if;
  if emp.work_email is null or trim(emp.work_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email_on_record');
  end if;
  if p_purpose <> 'device' and lower(trim(emp.work_email)) <> lower(trim(coalesce(p_email, ''))) then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;
  if coalesce(trim(p_code), '') = '' then
    raise exception 'issue_password_otp needs a code to hash';
  end if;

  select count(*) into recent from password_otp
  where employee_id = emp.id and created_at > now() - window_;
  if recent >= per_window then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  update password_otp set consumed_at = now()
  where employee_id = emp.id and purpose = p_purpose and consumed_at is null;

  insert into password_otp (employee_id, purpose, code_hash, sent_to, expires_at)
  values (emp.id, p_purpose, crypt(p_code, gen_salt('bf')),
          lower(trim(emp.work_email)), now() + ttl);

  perform log_audit('employee', emp.id, 'password_otp_issued',
                    jsonb_build_object('purpose', p_purpose));

  return jsonb_build_object(
    'ok', true, 'employee_id', emp.id, 'email', lower(trim(emp.work_email)),
    'name', emp.full_name, 'expires_in_minutes', 10);
end $function$;

-- Sessions from before today are the devices people already use.
insert into app_settings (key, value, description)
values ('device_check_since', to_jsonb(now()),
        'Sign-ins from this moment on ask for a code when the account is already signed in elsewhere (0149).')
on conflict (key) do nothing;

create table if not exists public.device_sessions (
  session_id  uuid primary key,
  user_id     uuid not null,
  verified_at timestamptz not null default now(),
  how         text not null check (how in ('only_device', 'code', 'code_signed_out_others'))
);
alter table public.device_sessions enable row level security;
revoke all on public.device_sessions from anon, authenticated;

create or replace function public.session_id_now()
returns uuid language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid
$$;
revoke execute on function public.session_id_now() from public, anon;

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
revoke execute on function public.device_check() from public, anon;
grant execute on function public.device_check() to authenticated;

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
  return 'pending';
end $function$;
revoke execute on function public.my_session_state() from public, anon;
grant execute on function public.my_session_state() to authenticated;

create or replace function public.confirm_device_session(p_user uuid, p_session uuid, p_signout_others boolean)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare ended integer := 0;
begin
  if not exists (select 1 from auth.sessions where id = p_session and user_id = p_user) then
    raise exception 'That sign-in has ended — sign in again';
  end if;
  insert into device_sessions (session_id, user_id, how)
  values (p_session, p_user, case when p_signout_others then 'code_signed_out_others' else 'code' end)
  on conflict (session_id) do update set verified_at = now(), how = excluded.how;
  -- The other sessions themselves are ended by the auth server (admin signOut, scope others),
  -- from the password-otp function: here, only what they had been allowed.
  if p_signout_others then
    select count(*) into ended from auth.sessions where user_id = p_user and id <> p_session;
    delete from device_sessions where user_id = p_user and session_id <> p_session;
  end if;
  perform log_audit('employee', (select id from employees where auth_user_id = p_user), 'device_signed_in',
                    jsonb_build_object('signed_out_others', p_signout_others, 'sessions_ended', ended));
  return ended;
end $function$;
-- The password-otp function calls it with the service role, after the code is right; nobody else may.
revoke execute on function public.confirm_device_session(uuid, uuid, boolean) from public, anon, authenticated;
