/*
  0248 — HR's employee upload never deactivates SW_ADMIN or a test login (the user, 3 Nov: "when hr uploads new emp,
  dont include sw_admin n test ids, bcz it is disbaling"). 0110 spared accounts off the payroll (payroll_managed), but
  E6666 had been left on it, so every upload switched it off. Now named in the function as well, so a flag left on
  cannot do it again: SW_ADMIN, E6666, E7777, E8888, E9999 and any "- Test" name.
*/
update public.employees set payroll_managed = false, is_active = true
where upper(ecode) in ('SW_ADMIN', 'E6666', 'E7777', 'E8888', 'E9999') or full_name ilike '%- test%';

create or replace function public.upload_spares(p_ecode text, p_name text)
returns boolean language sql immutable as $$
  select upper(btrim(coalesce(p_ecode, ''))) in ('SW_ADMIN', 'E6666', 'E7777', 'E8888', 'E9999')
      or coalesce(p_name, '') ilike '%- test%'
$$;
revoke all on function public.upload_spares(text, text) from public, anon;
grant execute on function public.upload_spares(text, text) to authenticated;

create or replace function public.deactivate_missing(p_ecodes text[])
returns table(ecode text, full_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  keep text[];
begin
  if not is_hr_admin() then
    raise exception 'Only HR Admin can deactivate employees';
  end if;

  keep := array(
    select distinct upper(btrim(x))
    from unnest(coalesce(p_ecodes, '{}'::text[])) as x
    where btrim(x) <> ''
  );

  if array_length(keep, 1) is null then
    raise exception 'That file had no employee codes in it. Nothing was changed';
  end if;

  update employees
  set reporting_manager_id = null
  where reporting_manager_id in (
    select e.id from employees e
    where e.is_active and e.payroll_managed and not upload_spares(e.ecode, e.full_name)
      and not (upper(e.ecode) = any(keep))
  );

  return query
  with gone as (
    update employees e
    set is_active = false
    where e.is_active
      and e.payroll_managed
      and not upload_spares(e.ecode, e.full_name)
      and not (upper(e.ecode) = any(keep))
    returning e.id, e.ecode, e.full_name
  ),
  logged as (
    select g.id,
           log_audit('employee', g.id, 'deactivated_by_master_upload',
                     jsonb_build_object('ecode', g.ecode)) as _
    from gone g
  )
  select g.ecode, g.full_name
  from gone g
  where exists (select 1 from logged l where l.id = g.id)
  order by g.ecode;
end $function$;
revoke all on function public.deactivate_missing(text[]) from public, anon;
grant execute on function public.deactivate_missing(text[]) to authenticated;
