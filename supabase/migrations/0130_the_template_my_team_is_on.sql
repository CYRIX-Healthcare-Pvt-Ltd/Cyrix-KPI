-- =====================================================================
-- Cyrix KPI  ·  0130  ·  The template my team is on
--
-- 0129 settled visibility at mine-and-below, and the backfill that
-- followed it exposed the gap.
--
-- Naming the shapes the company already shares put 717 of 778 active
-- KPIs on a template. Each one is owned by the lowest single manager
-- everybody on it sits under — which for the big shapes is high up:
-- "Biomedical Engineer", carried by 250 people, belongs to MOHANDAS N.
--
-- Nagasai has 207 people under him. Almost all of them are on that
-- template. He could not see it: it is owned above him, and above is
-- exactly what 0129 excluded. So the template covering his own team was
-- invisible to the manager of that team, and a new joiner of his could
-- not be put on the same KPI as the 207 people beside them.
--
-- One more clause: you also see a template that somebody in your own
-- downline is on. Not because of who owns it — because your people
-- carry it.
--
-- It stays narrow. is_mine is still ownership, so Nagasai can use it and
-- assign it and cannot edit or rename it; that remains MOHANDAS's, and
-- the count on it says how many people an edit would reach. And nothing
-- sideways leaks: a peer's template is visible only if it is on somebody
-- below you, which makes it yours to care about by definition.
-- =====================================================================

drop function if exists public.visible_kpi_templates(text);

create function public.visible_kpi_templates(p_fy text)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  owner_ecode text,
  is_company boolean,
  is_mine boolean,
  item_count bigint,
  in_use bigint,
  /** How many of MY people are on it — 0130. Nought for one I only own. */
  on_my_team bigint
)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

comment on function public.visible_kpi_templates(text) is
  'Templates the caller may use: their own, anybody''s below them, any '
  'their own people are already on, and HR''s for their job role. '
  'Editing is still ownership. See migration 0130.';

grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.visible_kpi_templates(text) to service_role;


-- Assigning follows the same reach, or a manager can see the template
-- their team is on and not be able to put a new joiner on it.
create or replace function public.can_use_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, job_role_id from employees where id = current_employee_id()
  ),
  below as (
    select downline_of((select id from me)) as id
  ),
  reach as (
    select id from me
    union
    select id from below
  )
  select exists (
    select 1 from kpi_templates t
    where t.id = p_template_id
      and t.status = 'active'
      and (
        t.owner_id in (select id from reach)
        or exists (
          select 1 from kpi_assignments a
          join below b on b.id = a.employee_id
          where a.source_template_id = t.id
            and a.status in ('active', 'pending_approval'))
        or (t.owner_id is null
            and t.job_role_id is not null
            and t.job_role_id = (select job_role_id from me))
        or is_hr_admin()
      )
  )
$$;

grant execute on function public.can_use_template(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the manager of a team on somebody else's template can see
-- it and use it, and still cannot call it theirs.
-- ---------------------------------------------------------------------
do $$
declare
  fy    text := (select f.code from financial_years f where f.is_current);
  mgr   record;
  seen  int;
  owned int;
begin
  -- A manager whose people are on a template owned outside their reach.
  select e.id, e.auth_user_id, a.source_template_id as tpl into mgr
  from employees e
  join kpi_assignments a on a.status = 'active' and a.financial_year = fy
    and a.source_template_id is not null
    and a.employee_id in (select d from downline_of(e.id) d)
  join kpi_templates t on t.id = a.source_template_id
  where e.auth_user_id is not null
    and e.is_active
    and t.owner_id is not null
    and t.owner_id <> e.id
    and t.owner_id not in (select d from downline_of(e.id) d)
  limit 1;

  if mgr.id is null then
    raise notice '0130 self-test: nobody''s team is on a template from outside their reach';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', mgr.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into seen
    from visible_kpi_templates(fy) v where v.id = mgr.tpl;

    select count(*) into owned
    from visible_kpi_templates(fy) v where v.id = mgr.tpl and v.is_mine;

    perform set_config('request.jwt.claims', '', true);

    if seen <> 1 then
      raise exception 'the manager cannot see the template their own team is on';
    end if;
    if owned <> 0 then
      raise exception 'a template they do not own came back as theirs';
    end if;
  end if;

  raise notice '0130 self-test passed (visible because my people are on it, not mine to change)';
end $$;
