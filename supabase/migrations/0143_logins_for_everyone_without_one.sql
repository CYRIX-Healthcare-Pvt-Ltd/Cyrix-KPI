-- =====================================================================
-- Cyrix KPI  ·  0143  ·  Logins for everybody who has none, in one press
--
-- A new person needs a login before they can sign in, and there were two
-- ways to make one:
--
--   * hr_create_login(ecode), for one person — the "Create their login"
--     button on their record, and the end of Add employee. It makes the
--     account in the database itself, and it works.
--   * the create-logins edge function, which a bulk import called at the
--     end. On 3 Oct HR_ADMIN imported eight new people and it made none:
--     every one of them was given a login by hand afterwards, or still has
--     none (the user, 5 Oct: "when new user is added why login details not
--     automatically generating? if 100 user is there, i need to do each
--     manually").
--
-- hr_create_missing_logins does what the import meant to: a login for
-- every active person who has none, through hr_create_login, so each is
-- made exactly as the button makes it — <ecode>@cyrix.local, the employee
-- code as the first password, the forced-change setting, and a
-- login_created line in the audit log. HR or the software administrator,
-- as for one login.
--
-- In batches (p_limit, at most 100): each login is a bcrypt hash, and a
-- whole company in one call would run past the statement time limit. The
-- caller asks again while `remaining` comes down. Anybody whose address
-- is already taken by an account that is not linked to them cannot be
-- made, and is listed apart (`unlinked`) rather than tried again on every
-- call, so they never hold up the people behind them.
--
-- hr_missing_logins lists who has none, for the screens that offer the
-- button.
-- =====================================================================

create or replace function public.hr_missing_logins()
returns table (ecode text, full_name text, created_at timestamptz, unlinked boolean)
language plpgsql stable security definer set search_path to 'public', 'extensions' as $fn$
declare
  domain text := coalesce(nullif(current_setting('app.auth_domain', true), ''), 'cyrix.local');
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR or the software administrator can see who has no login';
  end if;
  return query
    select upper(btrim(e.ecode)), e.full_name, e.created_at,
           exists (select 1 from auth.users u where lower(u.email) = lower(btrim(e.ecode)) || '@' || domain)
    from employees e
    where e.is_active and e.auth_user_id is null
    order by e.created_at, e.ecode;
end $fn$;

create or replace function public.hr_create_missing_logins(p_limit integer default 20)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare
  domain    text := coalesce(nullif(current_setting('app.auth_domain', true), ''), 'cyrix.local');
  r         record;
  created   text[] := '{}';
  failed    text[] := '{}';
  unlinked  text[];
  left_over integer;
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR or the software administrator can create logins';
  end if;

  for r in
    select e.ecode from employees e
    where e.is_active and e.auth_user_id is null
      and not exists (select 1 from auth.users u where lower(u.email) = lower(btrim(e.ecode)) || '@' || domain)
    order by e.created_at, e.ecode
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    -- One at a time, each on its own: a login that cannot be made is
    -- reported, and the rest are still made.
    begin
      perform hr_create_login(r.ecode);
      created := created || upper(btrim(r.ecode));
    exception when others then
      failed := failed || (upper(btrim(r.ecode)) || ': ' || sqlerrm);
    end;
  end loop;

  select coalesce(array_agg(upper(btrim(e.ecode)) order by e.ecode), '{}') into unlinked
  from employees e
  where e.is_active and e.auth_user_id is null
    and exists (select 1 from auth.users u where lower(u.email) = lower(btrim(e.ecode)) || '@' || domain);

  select count(*) into left_over
  from employees e
  where e.is_active and e.auth_user_id is null
    and not exists (select 1 from auth.users u where lower(u.email) = lower(btrim(e.ecode)) || '@' || domain);

  return jsonb_build_object(
    'created', to_jsonb(created),
    'failed', to_jsonb(failed),
    'unlinked', to_jsonb(unlinked),
    'remaining', left_over,
    'domain', domain);
end $fn$;

revoke all on function public.hr_missing_logins() from public, anon;
revoke all on function public.hr_create_missing_logins(integer) from public, anon;
grant execute on function public.hr_missing_logins() to authenticated, service_role;
grant execute on function public.hr_create_missing_logins(integer) to authenticated, service_role;
