-- =====================================================================
-- Cyrix KPI  ·  0069  ·  Admin is something you also are
--
-- `admin` was the fourth value of a role somebody could hold exactly one
-- of, which made it a job. It is not one. Everybody who administers Spare
-- also does something in it — a project manager who maintains the custom
-- fields, an engineer who was given the keys — and the enum forced a
-- choice between the two, so granting the keys quietly took the job away.
--
-- It becomes a flag alongside the role. Engineer + admin, manager +
-- admin, purchase + admin: all sayable now, and all previously not.
--
-- Nobody loses anything. The three existing admins are people whose whole
-- purpose is administering, and every check that used to read
-- `role = 'admin'` now reads the flag instead, so what they can do is
-- unchanged the moment this commits.
--
-- The enum keeps its 'admin' value: removing one is a table rewrite, and
-- an unused label costs nothing. Nothing writes it from here on.
-- =====================================================================

alter table profiles
  add column if not exists is_spare_admin boolean not null default false;

comment on column profiles.is_spare_admin is
  'Administers Spare — the custom fields, and approving anything a '
  'project manager can. Independent of `role`, because administering is '
  'something somebody also does rather than instead.';

-- Carry the three existing admins across before anything reads the flag.
update profiles set is_spare_admin = true where role::text = 'admin';

-- And give them a job, since `admin` is no longer one. Engineer is the
-- floor rather than a guess at seniority: is_spare_admin already grants
-- everything a project manager can do, so this decides nothing they
-- could otherwise lose, and inventing a promotion would.
update profiles set role = 'engineer'::user_role where role::text = 'admin';

-- ─────────────────────────────────────────────────────────────
-- The three checks, now reading the flag
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_spare_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_pm_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select role::text = 'project_manager' or is_spare_admin
    from profiles where id = auth.uid()
  ), false);
$$;

create or replace function public.can_approve_mapping() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select role::text in ('project_manager', 'purchase') or is_spare_admin
    from profiles where id = auth.uid()
  ), false);
$$;

-- ─────────────────────────────────────────────────────────────
-- KPI's admins stay Spare's admins
-- ─────────────────────────────────────────────────────────────
-- 0059 set `role = 'admin'` from user_roles, and on demotion sent people
-- back to engineer — which threw away whatever job they actually had.
-- Setting a flag has no such side effect: losing the keys now leaves the
-- role exactly where it was.
create or replace function public.spare_sync_admin_from_user_roles()
returns trigger
language plpgsql security definer set search_path = public as $sync_admin$
declare
  target uuid;
begin
  select e.auth_user_id into target
  from employees e
  where e.id = coalesce(new.employee_id, old.employee_id);

  if target is null then
    return coalesce(new, old);
  end if;

  perform set_config('spare.syncing', 'on', true);

  update profiles set is_spare_admin = exists (
    select 1 from user_roles ur
    join employees e2 on e2.id = ur.employee_id
    where e2.auth_user_id = target and ur.role in ('hr_admin', 'sw_admin')
  )
  where id = target;

  return coalesce(new, old);
end $sync_admin$;

notify pgrst, 'reload schema';

-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n integer;
  def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='is_spare_admin'
  ) then
    raise exception 'is_spare_admin was not added';
  end if;

  -- The three who were admins must still be admins.
  select count(*) into n from profiles where is_spare_admin;
  if n < 3 then
    raise exception 'expected at least the 3 existing admins to carry over, found %', n;
  end if;

  -- And nobody may still be holding the retired role, or they would show
  -- as having no job at all in a picker offering three.
  select count(*) into n from profiles where role::text = 'admin';
  if n <> 0 then
    raise exception '% profiles still hold the retired admin role', n;
  end if;

  -- Every admin must have kept the ability to approve, or this migration
  -- has quietly taken away the thing it was meant to preserve.
  select count(*) into n
  from profiles
  where is_spare_admin
    and role::text not in ('engineer', 'project_manager', 'purchase');
  if n <> 0 then
    raise exception '% admins hold no valid role', n;
  end if;

  for def in
    select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('is_admin', 'is_pm_or_admin', 'can_approve_mapping')
  loop
    if def not like '%is_spare_admin%' then
      raise exception 'a permission check still reads the old admin role';
    end if;
  end loop;

  raise notice '0069 self-test passed (admin is a flag; % hold it)',
    (select count(*) from profiles where is_spare_admin);
end $selftest$;
