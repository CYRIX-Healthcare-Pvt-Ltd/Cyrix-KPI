-- =====================================================================
-- Cyrix KPI  ·  0129  ·  Mine, and what is under me
--
-- Settled, after four attempts at it: a manager sees the templates they
-- wrote and the ones written by anybody below them. Nothing sideways,
-- nothing above.
--
-- What forced it, on live data: Nagasai (E870) and Raghwender (E165)
-- both report to MOHANDAS N, so under 0125's rule Raghwender's two
-- templates appeared in Nagasai's list. They are peers. A template
-- written for one division's engineers has no business in the other
-- division's list, and the SW admin's answer on seeing it was immediate.
--
--   E1561 MOHANDAS N
--     ├── E165 Raghwender  ── his templates are his and his team's
--     └── E870 Nagasai     ── sees his own and his 207 people's
--
-- The cost, stated rather than discovered: a new employee has nobody
-- below them, so their own "Use a team template" picker is empty. That
-- is not a gap any more — it is what Assign to is for. The manager hands
-- the template down; the joiner does not go looking for it.
--
-- shared_kpi_groups already looked only downward, so it is unchanged.
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
  in_use bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, job_role_id from employees where auth_user_id = auth.uid()
  ),
  reach as (
    -- Mine, and everybody's below me at any depth.
    select id from me
    union
    select downline_of((select id from me)) as id
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
      t.owner_id in (select id from reach)
      -- HR's, for the job role the caller actually holds. Unchanged
      -- since 0093, and the one thing that is not about hierarchy.
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
  'Templates the caller may use: their own, anybody''s below them at any '
  'depth, and HR''s for their job role. Not a peer''s, not their '
  'manager''s. See migration 0129.';

grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.visible_kpi_templates(text) to service_role;


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
  reach as (
    select id from me
    union
    select downline_of((select id from me)) as id
  )
  select exists (
    select 1 from kpi_templates t
    where t.id = p_template_id
      and t.status = 'active'
      and (
        t.owner_id in (select id from reach)
        or (t.owner_id is null
            and t.job_role_id is not null
            and t.job_role_id = (select job_role_id from me))
        or is_hr_admin()
      )
  )
$$;

grant execute on function public.can_use_template(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: a peer's template is not visible, and one's own is.
-- ---------------------------------------------------------------------
do $$
declare
  fy    text := (select f.code from financial_years f where f.is_current);
  pair  record;
  seen  int;
  own   int;
begin
  -- Two people under the same manager, one of whom owns a template.
  select a.id as caller_id, a.auth_user_id, b.id as peer_id into pair
  from employees a
  join employees b
    on b.reporting_manager_id = a.reporting_manager_id and b.id <> a.id
  where a.auth_user_id is not null
    and a.reporting_manager_id is not null
    and exists (select 1 from kpi_templates t
                where t.owner_id = b.id and t.status = 'active')
  limit 1;

  if pair.caller_id is null then
    raise notice '0129 self-test: no peer pair with a template between them';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pair.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into seen
    from visible_kpi_templates(fy) v
    where v.owner_id = pair.peer_id;

    select count(*) into own
    from visible_kpi_templates(fy) v
    where v.owner_id is not null
      and v.owner_id <> pair.caller_id
      and not exists (select 1 from downline_of(pair.caller_id) d where d = v.owner_id);

    perform set_config('request.jwt.claims', '', true);

    if seen > 0 then
      raise exception 'a peer''s % template(s) are still visible', seen;
    end if;
    if own > 0 then
      raise exception '% template(s) visible from outside mine-and-below', own;
    end if;
  end if;

  raise notice '0129 self-test passed (mine and below, nothing sideways)';
end $$;
