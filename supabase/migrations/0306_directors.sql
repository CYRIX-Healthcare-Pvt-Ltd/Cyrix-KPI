/*
 * 0306 · Directors (the user, 20 Nov: "the directors, e1, e2, e3, they are core members, here we can add 1 more
 * directors"; "further directors i will add"). SW Admin's role list gains Director. A director stays an employee
 * everywhere else (account_type 'employee', counted and listed as now); employees.is_director marks them.
 * Used by Travel only (te_0168): a claim whose reporting manager is a director skips the manager step.
 * E1, E2 and E3 are directors from the start.
 */
alter table public.employees add column if not exists is_director boolean not null default false;
update public.employees set is_director = true where ecode in ('E1', 'E2', 'E3') and not is_director;

create or replace function public.non_employee_ids()
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_object_agg(id, case when account_type = 'employee' then 'director' else account_type end), '{}')
  from employees where account_type <> 'employee' or is_director
$function$;

create or replace function public.set_account_type(p_employee_id uuid, p_type text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change an account type'; end if;
  if p_type not in ('employee', 'test', 'admin', 'director') then raise exception 'Unknown account type'; end if;
  update employees set account_type = case when p_type = 'director' then 'employee' else p_type end,
                       is_director = (p_type = 'director')
  where id = p_employee_id;
  perform log_audit('employee', p_employee_id, 'account_type', jsonb_build_object('type', p_type));
end $function$;
