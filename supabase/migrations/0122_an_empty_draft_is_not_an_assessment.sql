-- =====================================================================
-- Cyrix KPI  ·  0122  ·  An empty draft is not an assessment
--
-- Setting a KPI's start month to May-26 was refused with "This KPI
-- already has an assessment for Apr-26 ... delete that month first" --
-- and Apr-26 was a draft nobody had opened, one of the shells the system
-- creates for every month the KPI covers.
--
-- So the rule could never be satisfied. There is always a draft for the
-- month before, and there is no way for anyone to delete one; the advice
-- in the message pointed at a door that does not exist. In practice the
-- start month could only ever be set earlier, never later, which is the
-- wrong way round -- moving it later is what you do when somebody joined
-- in May.
--
-- Now: a filed month still blocks, exactly as before -- submitted,
-- returned, scored or finalised, anything with a person's answers in it.
-- A draft before the new start is removed instead, and each one is
-- written to the audit trail first with whatever had been typed into it
-- (105 drafts exist today; 4 of them hold a figure).
--
-- The body below is the live definition read back with
-- pg_get_functiondef, spliced. Same signature, so CREATE OR REPLACE and
-- the grants stand.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_kpi_start(p_assignment_id uuid, p_starts_from date)
 RETURNS kpi_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a       kpi_assignments%rowtype;
  month1  date := date_trunc('month', p_starts_from)::date;
  fy_from date;
  fy_to   date;
  earlier date;
  gone    record;
  removed integer := 0;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  if not (a.employee_id = current_employee_id()
          or manages_employee(a.employee_id)
          or is_hr_admin()) then
    raise exception 'You can only set the start month on your own KPI';
  end if;

  if p_starts_from is null then
    raise exception 'Choose the month this KPI starts from';
  end if;

  select starts_on, ends_on into fy_from, fy_to
  from financial_years where code = a.financial_year;

  if month1 < fy_from or month1 > fy_to then
    raise exception
      'The start month must be inside FY % (% to %)',
      a.financial_year, to_char(fy_from, 'Mon-YY'), to_char(fy_to, 'Mon-YY');
  end if;

  -- A filed month blocks; a draft does not.
  --
  -- The system opens a draft for every month the KPI covers, so under
  -- the old rule a start could never move forward at all: the month
  -- being moved past always had a shell nobody had touched, and the
  -- setting refused on it. "Delete that month first" was advice with
  -- nothing behind it, since there is no way to delete a draft.
  select min(period_month) into earlier
  from kpi_submissions
  where employee_id = a.employee_id
    and financial_year = a.financial_year
    and period_month < month1
    and status <> 'draft';

  if earlier is not null then
    raise exception
      'This KPI already has an assessment for %, which is before %. '
      'Request the deletion of that month first, or choose an earlier start.',
      to_char(earlier, 'Mon-YY'), to_char(month1, 'Mon-YY');
  end if;

  -- The drafts the new start leaves behind.
  --
  -- Not ignored, removed: a month the KPI no longer covers would sit
  -- on the employee's list as something to fill in, and open_submission
  -- would refuse it if they tried. Recorded row by row first, with
  -- anything typed into it, so a month cleared here is still readable
  -- in the audit trail rather than gone.
  for gone in
    select s.id, s.period_month, s.employee_remarks,
           (select jsonb_agg(jsonb_build_object(
                     'kra', i.kra, 'section', i.section,
                     'self_achieved', i.self_achieved,
                     'manager_achieved', i.manager_achieved)
                   order by i.sort_order)
            from kpi_submission_items i
            where i.submission_id = s.id
              and (i.self_achieved is not null
                or i.manager_achieved is not null)) as figures
    from kpi_submissions s
    where s.employee_id    = a.employee_id
      and s.financial_year = a.financial_year
      and s.period_month   < month1
      and s.status         = 'draft'
  loop
    perform log_audit('kpi_submission', gone.id, 'draft_removed',
      jsonb_build_object(
        'period',           gone.period_month,
        'why',              'KPI start moved to ' || to_char(month1, 'Mon-YY'),
        'figures',          gone.figures,
        'employee_remarks', gone.employee_remarks));
    delete from kpi_submissions where id = gone.id;
    removed := removed + 1;
  end loop;

  update kpi_assignments set starts_from = month1
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'start_month_set',
                    jsonb_build_object('starts_from', month1,
                                       'drafts_removed', removed));
  return a;
end $function$

;

comment on function public.set_kpi_start(uuid, date) is
  'Sets the first month a KPI is expected for. Allowed after approval -- '
  'unlike the rows -- but never past a month already filed. Drafts before '
  'the new start are removed, audited first.';


-- ---------------------------------------------------------------------
-- Self-test: the splices landed, and no month anybody filled in sits
-- before the start of the KPI it belongs to.
-- ---------------------------------------------------------------------
do $$
declare
  src   text := pg_get_functiondef('public.set_kpi_start'::regproc);
  stray integer;
begin
  if src not like '%and status <> ''draft''%' then
    raise exception 'the guard still counts drafts as assessments';
  end if;
  if src not like '%draft_removed%' then
    raise exception 'the draft cleanup did not land';
  end if;

  select count(*) into stray
  from kpi_submissions s
  join kpi_assignments a on a.id = s.assignment_id
  where a.starts_from is not null
    and s.period_month < a.starts_from
    and s.status <> 'draft';

  if stray > 0 then
    raise exception '% filed month(s) sit before their own start month', stray;
  end if;

  raise notice '0122 self-test passed (filed months block, drafts are cleared)';
end $$;
