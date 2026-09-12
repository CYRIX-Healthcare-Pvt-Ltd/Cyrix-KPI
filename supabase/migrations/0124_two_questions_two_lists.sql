-- =====================================================================
-- Cyrix KPI  ·  0124  ·  Two questions, two lists
--
-- 0123 turned template visibility around, and half of that was wrong.
--
-- There are two different questions being asked of one function:
--
--   "Which template do I start my own KPI from?"  asked on the setup
--   screen, by the person being appraised. The answer has to be their
--   manager's and above — a new joiner has nobody below them, and a
--   flipped list leaves them staring at an empty picker on the one
--   screen that exists to save them typing.
--
--   "Which templates do I look after?"  asked on the team templates
--   screen, by a manager. The answer is mine, and everybody's below me:
--   Saranya reuses what Adrian and Sreemon have already written, and
--   Sreemon does not get handed his manager's Zonal Manager KPI.
--
-- So visible_kpi_templates goes back to walking up, and keeps the in_use
-- count 0123 gave it. manageable_kpi_templates is the new one, and walks
-- down. Same shape, so one screen component reads either.
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
  -- RECURSIVE leads the whole chain, not just the member that recurses:
  -- Postgres reads it as a property of the WITH clause.
  with recursive me as (
    select id, job_role_id from employees where auth_user_id = auth.uid()
  ),
  -- The caller and everybody above them. The caller is in it on purpose:
  -- your own templates are the ones you are most likely to want.
  line as (
    select id, reporting_manager_id from employees where id = (select id from me)
    union all
    select e.id, e.reporting_manager_id
    from employees e join line l on e.id = l.reporting_manager_id
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
      t.owner_id in (select id from line)
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by (t.owner_id is null), o.full_name nulls first, t.name;
$$;

comment on function public.visible_kpi_templates(text) is
  'What one person may start their own KPI from: their own, their '
  'managers'' up the line, and HR''s for their job role. The setup '
  'screen''s list. See migration 0124.';

grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.visible_kpi_templates(text) to service_role;


-- ---------------------------------------------------------------------
-- What a manager looks after: theirs, and everybody's below them.
-- ---------------------------------------------------------------------
create or replace function public.manageable_kpi_templates(p_fy text)
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
  below as (
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
      t.owner_id = (select id from me)
      or t.owner_id in (select id from below)
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by
    -- Mine first, then the managers below me by name, then HR's.
    (t.owner_id is null),
    (t.owner_id is distinct from (select id from me)),
    o.full_name nulls first,
    t.name;
$$;

comment on function public.manageable_kpi_templates(text) is
  'What a manager looks after: their own templates, everybody''s below '
  'them at any depth, and HR''s for their job role — each with its row '
  'count and how many people are on it. See migration 0124.';

grant execute on function public.manageable_kpi_templates(text) to authenticated;
grant execute on function public.manageable_kpi_templates(text) to service_role;


-- ---------------------------------------------------------------------
-- Self-test: the two lists answer different questions, and each obeys
-- its own direction.
-- ---------------------------------------------------------------------
do $$
declare
  caller  record;
  fy      text := (select f.code from financial_years f where f.is_current);
  up_bad  int;
  down_bad int;
begin
  -- Somebody with a manager above them and a template owner below them,
  -- so both directions have something to get wrong.
  select e.id, e.auth_user_id into caller
  from employees e
  where e.auth_user_id is not null
    and e.reporting_manager_id is not null
    and exists (
      select 1 from downline_of(e.id) d
      join kpi_templates t on t.owner_id = d and t.status = 'active')
  limit 1;

  if caller.id is null then
    raise notice '0124 self-test: nobody has both a manager and a template below them yet';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', caller.auth_user_id, 'role', 'authenticated')::text, true);

    -- The setup list must hold nothing from below.
    select count(*) into up_bad
    from visible_kpi_templates(fy) v
    where v.owner_id is not null
      and exists (select 1 from downline_of(caller.id) d where d = v.owner_id);

    -- The management list must hold nothing from above.
    select count(*) into down_bad
    from manageable_kpi_templates(fy) m
    where m.owner_id is not null
      and m.owner_id <> caller.id
      and not exists (select 1 from downline_of(caller.id) d where d = m.owner_id);

    perform set_config('request.jwt.claims', '', true);

    if up_bad > 0 then
      raise exception 'the setup list offers % template(s) from below the caller', up_bad;
    end if;
    if down_bad > 0 then
      raise exception 'the management list holds % template(s) from above the caller', down_bad;
    end if;
  end if;

  raise notice '0124 self-test passed (the setup list looks up, the management list looks down)';
end $$;
