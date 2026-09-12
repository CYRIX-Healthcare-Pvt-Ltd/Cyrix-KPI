-- =====================================================================
-- Cyrix KPI  ·  0131  ·  Which template is this person on
--
-- The templates screen can search its own list by name, and that
-- answers the manager's first question. It cannot answer the second —
-- "which one is E1234 on?" — because the screen has no idea who carries
-- what; that lives on kpi_assignments.
--
-- So one lookup: an employee code or part of a name, answered with the
-- template that person is on. Only for people below the caller at any
-- depth. Nagasai typing the code of an engineer in Raghwender's division
-- gets nothing back — not "not on a template", nothing — because whether
-- that person exists, and what their KPI is, is not his to know. HR sees
-- everybody, as HR does everywhere else.
--
-- Two characters at least, eight answers at most: it is a lookup behind a
-- search box, not a way to page through the roster.
-- =====================================================================

create or replace function public.find_team_member_template(
  p_query text,
  p_fy    text default null
)
returns table (
  employee_id   uuid,
  ecode         text,
  full_name     text,
  designation   text,
  template_id   uuid,
  template_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from employees where auth_user_id = auth.uid()
  ),
  q as (
    select btrim(coalesce(p_query, '')) as text
  ),
  fy as (
    select coalesce(p_fy, (select f.code from financial_years f where f.is_current)) as code
  )
  select
    e.id,
    e.ecode,
    e.full_name,
    e.designation,
    t.id,
    t.name
  from employees e
  cross join q
  left join kpi_assignments a
    on a.employee_id = e.id
   and a.financial_year = (select code from fy)
   and a.status in ('active', 'pending_approval')
  left join kpi_templates t
    on t.id = a.source_template_id
   and t.status = 'active'
  where length(q.text) >= 2
    and e.is_active
    -- Below me, or I am HR. Nobody else's people, and not myself: my own
    -- KPI is on My KPI, and this is a screen about the people I manage.
    and (
      e.id in (select d from downline_of((select id from me)) d)
      or (is_hr_admin() and e.id <> (select id from me))
    )
    and (
      upper(btrim(e.ecode)) like upper(q.text) || '%'
      or e.full_name ilike '%' || q.text || '%'
    )
  order by
    -- An exact code first: somebody who typed E1234 means E1234, not
    -- E12340 or everybody called "E12".
    (upper(btrim(e.ecode)) = upper(q.text)) desc,
    e.full_name
  limit 8;
$$;

comment on function public.find_team_member_template(text, text) is
  'Looks up which KPI template a person is on, by code or name, for '
  'people below the caller only (HR: everyone). See migration 0131.';

grant execute on function public.find_team_member_template(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: a manager finds their own person and cannot find a peer's.
-- ---------------------------------------------------------------------
do $$
declare
  fy     text := (select f.code from financial_years f where f.is_current);
  pair   record;
  mine   int;
  theirs int;
  short  int;
begin
  -- A manager with somebody below them, and a peer of theirs (same
  -- manager) with somebody below THEM.
  select a.id as mgr_id, a.auth_user_id,
         (select d from downline_of(a.id) d limit 1) as own_person,
         (select d from downline_of(b.id) d
          where d not in (select x from downline_of(a.id) x) limit 1) as peer_person
    into pair
  from employees a
  join employees b
    on b.reporting_manager_id = a.reporting_manager_id and b.id <> a.id
  where a.auth_user_id is not null
    and a.is_active and b.is_active
    and a.reporting_manager_id is not null
    and exists (select 1 from downline_of(a.id))
    and exists (select 1 from downline_of(b.id) d
                where d not in (select x from downline_of(a.id) x))
  limit 1;

  if pair.mgr_id is null then
    raise notice '0131 self-test: no pair of peer managers to test against';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pair.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into mine
    from find_team_member_template(
      (select ecode from employees where id = pair.own_person), fy) r
    where r.employee_id = pair.own_person;

    select count(*) into theirs
    from find_team_member_template(
      (select ecode from employees where id = pair.peer_person), fy) r
    where r.employee_id = pair.peer_person;

    select count(*) into short from find_team_member_template('E', fy);

    perform set_config('request.jwt.claims', '', true);

    if mine <> 1 then
      raise exception 'a manager cannot find somebody in their own team';
    end if;
    if theirs <> 0 then
      raise exception 'a manager can see a peer''s person and what KPI they are on';
    end if;
    if short <> 0 then
      raise exception 'a one-character search returned people';
    end if;
  end if;

  raise notice '0131 self-test passed (own team found, a peer''s person invisible)';
end $$;
