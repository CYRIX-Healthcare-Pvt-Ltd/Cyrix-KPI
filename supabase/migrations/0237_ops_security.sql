/*
  0237 — Ops: a Security panel (the user, 31 Oct: "do 4").

  The 9 Oct security audit's two critical findings were admin accounts still on the issued default password,
  and testing_mode left on in production. Neither was visible anywhere afterwards, so nobody could tell whether
  they had been fixed. This puts them on the Ops page, measured rather than assumed:

    ops_pw_check          one row per active account: is its password still the issued default (upper(ecode),
                          0009/0015)? Found by checking the stored hash against that one known value — the same
                          comparison sign-in makes. Only the yes/no is kept. employees.password_is_default can't
                          answer this: it reads true for 1,191 of 1,197 accounts because most password changes
                          never clear it.
    ops_pw_scan()         pg_cron, every 15 minutes: the 120 accounts checked longest ago (about 10 s of bcrypt),
                          so every account is re-checked about every 3 hours without one long job.
    ops_security()        for the page: testing_mode, default-password counts, the admin-role accounts still on
                          their default by name, accounts that must change password at sign-in, database and file
                          storage size. Ops admins only.

  Nothing here changes anybody's password or flags. Undo: supabase/undo/0237_ops_security.undo.sql.
*/

create table if not exists ops_pw_check (
  employee_id  uuid primary key references employees(id) on delete cascade,
  is_default   boolean not null,
  checked_at   timestamptz not null default now()
);
alter table ops_pw_check enable row level security;

create or replace function ops_pw_scan(p_batch int default 120)
returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare n int;
begin
  with due as (
    select e.id, upper(e.ecode) code, u.encrypted_password hash
    from employees e
    join auth.users u on u.id = e.auth_user_id
    left join ops_pw_check c on c.employee_id = e.id
    where e.is_active and u.encrypted_password is not null and u.encrypted_password <> ''
    order by c.checked_at nulls first
    limit greatest(1, least(coalesce(p_batch, 120), 500))
  )
  insert into ops_pw_check (employee_id, is_default, checked_at)
  select id, hash = extensions.crypt(code, hash), now() from due
  on conflict (employee_id) do update set is_default = excluded.is_default, checked_at = excluded.checked_at;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function ops_pw_scan(int) from public, anon, authenticated;

create or replace function ops_security()
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'testing_mode', coalesce((select value from app_settings where key = 'testing_mode'), 'null'::jsonb),
    'accounts', (select count(*) from employees where is_active),
    'checked', (select count(*) from ops_pw_check c join employees e on e.id = c.employee_id
                 where e.is_active and c.checked_at > now() - interval '1 day'),
    'default_pw', (select count(*) from ops_pw_check c join employees e on e.id = c.employee_id
                    where e.is_active and c.is_default),
    'must_change', (select count(*) from employees where is_active and must_change_password),
    'last_scan', (select max(checked_at) from ops_pw_check),
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object('code', e.ecode, 'name', e.full_name, 'roles', r.roles,
                                          'default_pw', c.is_default) order by c.is_default desc nulls first, e.ecode)
      from (select employee_id, array_agg(distinct role::text) roles from user_roles group by employee_id) r
      join employees e on e.id = r.employee_id and e.is_active
      left join ops_pw_check c on c.employee_id = e.id), '[]'::jsonb),
    'db_bytes', pg_database_size(current_database()),
    'storage', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'files', n, 'bytes', b) order by b desc)
      from (select bucket_id, count(*) n, coalesce(sum((metadata->>'size')::bigint), 0) b
            from storage.objects group by bucket_id) s), '[]'::jsonb)
  );
end $$;

revoke all on function ops_security() from public, anon;
grant execute on function ops_security() to authenticated, service_role;

select cron.unschedule('ops-pw-scan') where exists (select 1 from cron.job where jobname = 'ops-pw-scan');
select cron.schedule('ops-pw-scan', '*/15 * * * *', 'select public.ops_pw_scan(120)');

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
begin
  begin
    perform ops_security();
    raise exception '0237: ops_security() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('authenticated', 'ops_pw_scan(int)', 'execute') then
    raise exception '0237: a signed-in user can run the password scan';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ops-pw-scan') then raise exception '0237: ops-pw-scan not scheduled'; end if;
  raise notice '0237: security panel ready; the first full pass over every account takes about 3 hours';
end $$;
