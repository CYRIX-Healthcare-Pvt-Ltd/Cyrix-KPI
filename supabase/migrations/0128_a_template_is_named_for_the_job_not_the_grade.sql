-- =====================================================================
-- Cyrix KPI  ·  0128  ·  A template is named for the job, not the grade
--
-- 0127 suggested a name by taking the commonest designation in the
-- group, and on real data that came out "Jr.Biomedical Engineer" for a
-- shape carried by 132 people — most of whom are not junior. The group
-- exists precisely because the KPI does not distinguish them: a junior
-- and a senior biomedical engineer on the same four rows are on the
-- same KPI, and naming it after one grade makes it look like it is not
-- for the other.
--
-- So the seniority prefix comes off before the mode is taken, which also
-- makes the mode sharper: "Biomedical Engineer", "Jr.Biomedical
-- Engineer" and "Sr. Biomedical Engineer" were three designations
-- splitting one vote between them, and are now one.
--
-- The same cleaning is used for the list of designations shown beside
-- the group, so the manager reads three roles rather than nine spellings
-- of three roles.
--
-- Nothing about grade is lost anywhere it matters — this is the label on
-- a template, and the employee record still says what each person is.
-- =====================================================================

create or replace function public.role_label(p_designation text)
returns text
language sql
immutable
as $$
  -- Jr, Jr., Junior, Sr, Sr., Senior — with or without the space after
  -- the dot, because both spellings are in the roster.
  select nullif(btrim(regexp_replace(
    coalesce(p_designation, ''),
    '^\s*(jr|sr|junior|senior)\.?\s*', '', 'i')), '')
$$;

comment on function public.role_label(text) is
  'A designation with the seniority prefix taken off, for naming a '
  'template after the job rather than the grade. See migration 0128.';

grant execute on function public.role_label(text) to authenticated;


create or replace function public.shared_kpi_groups(p_fy text default null)
returns table (
  shape text,
  people integer,
  row_count integer,
  suggested_name text,
  designations text,
  examples text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from employees where auth_user_id = auth.uid()
  ),
  unnamed as (
    select
      a.id as assignment_id,
      role_label(e.designation) as role,
      e.full_name,
      kpi_shape(a.id) as shape,
      (select count(*) from kpi_assignment_items ai
        where ai.assignment_id = a.id and ai.section = 'job_role') as rows
    from kpi_assignments a
    join employees e on e.id = a.employee_id and e.is_active
    where a.status = 'active'
      and a.financial_year = coalesce(
        p_fy, (select f.code from financial_years f where f.is_current))
      and a.source_template_id is null
      and (is_hr_admin()
        or e.id in (select d from downline_of((select id from me)) d))
  )
  select
    u.shape,
    count(*)::int,
    max(u.rows)::int,
    -- The job most of them do, with the grade off it. A group of eleven
    -- biomedical engineers of three grades is a Biomedical Engineer
    -- template, and the manager renames it if it is not.
    coalesce(
      nullif(btrim(mode() within group (order by u.role)), ''),
      'Shared KPI'),
    (select string_agg(d, ', ' order by d)
     from (select distinct u2.role as d
           from unnamed u2 where u2.shape = u.shape
             and u2.role is not null limit 6) x),
    (select string_agg(n, ', ')
     from (select u3.full_name as n
           from unnamed u3 where u3.shape = u.shape
           order by u3.full_name limit 3) y)
  from unnamed u
  where u.shape is not null
  group by u.shape
  having count(*) > 1
  order by count(*) desc;
$$;

comment on function public.shared_kpi_groups(text) is
  'KPI shapes that two or more people in the caller''s team share and '
  'nobody has named, with a name suggested from the job rather than the '
  'grade. See migrations 0127 and 0128.';

grant execute on function public.shared_kpi_groups(text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the grade comes off, and the job does not.
-- ---------------------------------------------------------------------
do $$
declare
  bad text;
begin
  if role_label('Jr.Biomedical Engineer') <> 'Biomedical Engineer' then
    raise exception 'Jr. with no space is not handled';
  end if;
  if role_label('Sr. Specialist Engineer') <> 'Specialist Engineer' then
    raise exception 'Sr. with a space is not handled';
  end if;
  if role_label('Junior Auditor') <> 'Auditor' then
    raise exception 'the spelled-out grade is not handled';
  end if;
  if role_label('SENIOR ENGINEER') <> 'ENGINEER' then
    raise exception 'the case is not ignored';
  end if;
  -- And the two that must survive intact: a grade in the middle of a
  -- title, and a job that merely starts with those letters.
  if role_label('Engineer - Jr Grade') <> 'Engineer - Jr Grade' then
    raise exception 'a grade elsewhere in the title was eaten';
  end if;
  if role_label('Junction Box Technician') <> 'Junction Box Technician' then
    raise exception 'a job starting with Jun was mangled';
  end if;
  if role_label(null) is not null or role_label('  ') is not null then
    raise exception 'an empty designation should come back null';
  end if;

  -- No group should now be suggested a name with a grade in it.
  select string_agg(distinct g.suggested_name, ', ')
    into bad
  from (
    select role_label(e.designation) as suggested_name
    from employees e where e.is_active and e.designation is not null
  ) g
  where g.suggested_name ~* '^(jr|sr|junior|senior)\.?\s';

  if bad is not null then
    raise exception 'these still carry a grade: %', bad;
  end if;

  raise notice '0128 self-test passed (the grade comes off, the job stays)';
end $$;
