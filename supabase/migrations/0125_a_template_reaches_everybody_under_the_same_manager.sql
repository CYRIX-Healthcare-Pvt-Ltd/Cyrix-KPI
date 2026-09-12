-- =====================================================================
-- Cyrix KPI  ·  0125  ·  A template reaches everybody under the same manager
--
-- Third attempt at one rule, and this is the one that fits every case
-- the SW admin described. 0123 turned the list upside down; 0124 split
-- it in two and kept the old rule for the setup screen. Both were
-- narrower than what was asked for.
--
-- The rule: you may use a template owned by anybody under your own
-- manager — yourself, your peers, and everything below any of you — and
-- never your own manager's.
--
--   Saranya
--     ├── Adrian ──── Sreemon
--     └── (a new joiner)
--
--   The new joiner sees Adrian's and Sreemon's: both sit under Saranya,
--   and so do they. That is the whole point — somebody arriving into
--   Adrian's kind of job starts from Adrian's KPI instead of an empty
--   grid.
--
--   Sreemon does not see Adrian's. Adrian is his manager, not somebody
--   under his manager, and handing an employee their own manager's KPI
--   is how a Zonal Manager template ends up on an engineer.
--
--   Adrian sees Sreemon's, because Sreemon is under Saranya too.
--
-- Somebody at the top of the tree has no manager, so their cone is their
-- own downline: everybody.
--
-- One function for both screens. The setup picker lists what a person
-- may start from; the team templates screen lists the same set grouped
-- by who keeps each one, and edits only what is_mine. Which is why
-- manageable_kpi_templates goes: it answered a question that turned out
-- to be the same question.
--
-- The list is much longer under this rule than under either of the last
-- two, which is why the picker gained a search box in the same change.
-- =====================================================================

drop function if exists public.manageable_kpi_templates(text);
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
  /** Active KPIs this year that came from this template. */
  in_use bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, reporting_manager_id, job_role_id
    from employees where auth_user_id = auth.uid()
  ),
  cone as (
    -- Everybody under my own manager. Mine included, because a template
    -- I keep is the one I am most likely to want; my manager's excluded,
    -- because it is not written for the job I do.
    select id from me
    union
    select downline_of(
      coalesce((select reporting_manager_id from me), (select id from me))) as id
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
        and a.status in ('active', 'pending_approval'))
  from kpi_templates t
  left join employees o on o.id = t.owner_id
  where t.status = 'active'
    and coalesce(t.financial_year, p_fy) = p_fy
    and (
      t.owner_id in (select id from cone)
      -- HR's, for the job role the caller actually holds. Unchanged
      -- since 0093.
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by
    -- Mine first, then whoever keeps the rest, by name. HR's last.
    (t.owner_id is null),
    (t.owner_id is distinct from (select id from me)),
    o.full_name nulls first,
    t.name;
$$;

comment on function public.visible_kpi_templates(text) is
  'Templates the caller may use: their own, anybody''s under their own '
  'manager at any depth, and HR''s for their job role. Never their own '
  'manager''s. With row count and how many people are on each. '
  'See migration 0125.';

grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.visible_kpi_templates(text) to service_role;


-- ---------------------------------------------------------------------
-- Assigning follows the same reach.
--
-- A manager may hand out any template they can see — their own, a
-- peer's, one from further down — to anybody in their own downline.
-- Those are two different sets on purpose: what you may copy is wide,
-- who you may impose it on is narrow.
-- ---------------------------------------------------------------------
create or replace function public.can_use_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, reporting_manager_id, job_role_id
    from employees where id = current_employee_id()
  ),
  cone as (
    select id from me
    union
    select downline_of(
      coalesce((select reporting_manager_id from me), (select id from me))) as id
  )
  select exists (
    select 1 from kpi_templates t
    where t.id = p_template_id
      and t.status = 'active'
      and (
        t.owner_id in (select id from cone)
        or (t.owner_id is null
            and t.job_role_id is not null
            and t.job_role_id = (select job_role_id from me))
        or is_hr_admin()
      )
  )
$$;

grant execute on function public.can_use_template(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the shape of the cone, on the real tree.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text := (select f.code from financial_years f where f.is_current);
  emp      record;
  mgr_own  int;
  bad      int;
begin
  -- Somebody whose manager owns a template: that template must NOT be
  -- in their list, and that is the case the last two migrations got
  -- wrong in opposite directions.
  select e.id, e.auth_user_id, e.reporting_manager_id into emp
  from employees e
  where e.auth_user_id is not null
    and exists (
      select 1 from kpi_templates t
      where t.owner_id = e.reporting_manager_id and t.status = 'active')
  limit 1;

  if emp.id is null then
    raise notice '0125 self-test: nobody has a template-owning manager to check against';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into mgr_own
    from visible_kpi_templates(fy) v
    where v.owner_id = emp.reporting_manager_id;

    -- And everything in the list is either mine, HR's, or under my manager.
    select count(*) into bad
    from visible_kpi_templates(fy) v
    where v.owner_id is not null
      and v.owner_id <> emp.id
      and not exists (
        select 1 from downline_of(emp.reporting_manager_id) d where d = v.owner_id);

    perform set_config('request.jwt.claims', '', true);

    if mgr_own > 0 then
      raise exception 'the caller can see their own manager''s % template(s)', mgr_own;
    end if;
    if bad > 0 then
      raise exception '% template(s) from outside the caller''s cone', bad;
    end if;
  end if;

  raise notice '0125 self-test passed (under my manager, never my manager''s own)';
end $$;
