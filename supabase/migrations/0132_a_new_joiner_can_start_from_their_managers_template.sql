-- =====================================================================
-- Cyrix KPI  ·  0132  ·  A new joiner can start from their manager's template
--
-- 0129 settled the templates screen at "mine, what is under me, and what
-- my people are on" — never my manager's. Correct for the screen a
-- manager uses to look after templates, and it left a new employee's own
-- "Use a template" list empty by construction: they have nobody below
-- them and are on nothing yet.
--
-- Found the way it would be found in real use. E9999 saved Nivek's
-- approved KPI as "Sr MIS"; E7777, who also reports to E9999, opened KPI
-- setup to start from it — and the list offered nothing at all.
--
-- So one exception, on one screen: the person setting up their own KPI
-- also sees the templates their direct manager keeps. Only the direct
-- manager — the one who will approve it and who wrote it for exactly
-- this — and only when the setup screen asks. The Team templates screen
-- does not pass the flag and is unchanged.
--
-- Nothing else was in the way: templates and their rows are readable by
-- any signed-in employee (writing is owner-only), so the list was the
-- whole of the gap.
--
-- The body is the live 0130 definition read back with pg_get_functiondef,
-- with two splices. The argument list changes, so the old one-argument
-- function is dropped first — otherwise the new one would be an overload
-- and a call with only p_fy would be ambiguous.
-- =====================================================================

drop function if exists public.visible_kpi_templates(text);

CREATE OR REPLACE FUNCTION public.visible_kpi_templates(p_fy text, p_with_manager boolean DEFAULT false)
 RETURNS TABLE(id uuid, name text, owner_id uuid, owner_name text, owner_ecode text, is_company boolean, is_mine boolean, item_count bigint, in_use bigint, on_my_team bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select id, job_role_id from employees where auth_user_id = auth.uid()
  ),
  below as (
    select downline_of((select id from me)) as id
  ),
  reach as (
    select id from me
    union
    select id from below
  ),
  -- Templates my own people are on, and how many of them.
  ours as (
    select a.source_template_id as id, count(*) as n
    from kpi_assignments a
    join below b on b.id = a.employee_id
    where a.source_template_id is not null
      and a.financial_year = p_fy
      and a.status in ('active', 'pending_approval')
    group by 1
  )
  select
    t.id,
    t.name,
    t.owner_id,
    o.full_name,
    o.ecode,
    t.owner_id is null,
    t.owner_id = (select id from me),
    (select count(*) from kpi_template_items i
      where i.template_id = t.id and i.section = 'job_role'),
    (select count(*) from kpi_assignments a
      where a.source_template_id = t.id
        and a.financial_year = p_fy
        and a.status in ('active', 'pending_approval')),
    coalesce(ours.n, 0)
  from kpi_templates t
  left join employees o on o.id = t.owner_id
  left join ours on ours.id = t.id
  where t.status = 'active'
    and coalesce(t.financial_year, p_fy) = p_fy
    and (
      -- Mine, or written by somebody below me.
      t.owner_id in (select id from reach)
      -- Or one my own people are already on, wherever it was written.
      or ours.n > 0
      -- Or, asked for from the person's own KPI setup screen, what
      -- their DIRECT manager keeps (0132). Never two levels up, and never
      -- on the Team templates screen, which does not pass this.
      or (p_with_manager
          and t.owner_id = (select e.reporting_manager_id from employees e
                            where e.id = (select id from me)))
      -- Or HR's, for the job role the caller actually holds.
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by
    (t.owner_id is null),
    (t.owner_id is distinct from (select id from me)),
    o.full_name nulls first,
    t.name;
$function$

;

grant execute on function public.visible_kpi_templates(text, boolean) to authenticated;
grant execute on function public.visible_kpi_templates(text, boolean) to service_role;


-- ---------------------------------------------------------------------
-- Self-test: the manager's template reaches the setup list and only the
-- setup list.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text := (select f.code from financial_years f where f.is_current);
  emp      record;
  on_setup int;
  on_team  int;
  grand    int;
begin
  -- Somebody who can sign in, whose direct manager owns a template.
  select e.id, e.auth_user_id, e.reporting_manager_id as mgr,
         (select m.reporting_manager_id from employees m where m.id = e.reporting_manager_id) as grand_mgr
    into emp
  from employees e
  where e.auth_user_id is not null
    and e.is_active
    and exists (select 1 from kpi_templates t
                where t.owner_id = e.reporting_manager_id and t.status = 'active'
                  and coalesce(t.financial_year, fy) = fy)
  limit 1;

  if emp.id is null then
    raise notice '0132 self-test: nobody''s manager keeps a template';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into on_setup
    from visible_kpi_templates(fy, true) v where v.owner_id = emp.mgr;

    select count(*) into on_team
    from visible_kpi_templates(fy) v where v.owner_id = emp.mgr
      -- the manager's template can legitimately be here if my people
      -- are on it; this checks the flag, not that rule
      and v.on_my_team = 0;

    select count(*) into grand
    from visible_kpi_templates(fy, true) v
    where emp.grand_mgr is not null and v.owner_id = emp.grand_mgr
      and v.on_my_team = 0;

    perform set_config('request.jwt.claims', '', true);

    if on_setup = 0 then
      raise exception 'the setup list does not offer the direct manager''s template';
    end if;
    if on_team > 0 then
      raise exception 'the templates screen now shows the manager''s template without the flag';
    end if;
    if grand > 0 then
      raise exception 'the setup list reaches two levels up';
    end if;
  end if;

  raise notice '0132 self-test passed (direct manager on setup only, never two levels up)';
end $$;
