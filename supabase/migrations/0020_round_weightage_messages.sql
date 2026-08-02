-- =====================================================================
-- Cyrix KPI  ·  0020  ·  One decimal in the weightage messages
--
-- "Job Role weightages total 50.000%, they must total 80.000%" — the
-- three decimals are the column's stored scale, which format() prints in
-- full. Nobody writes a weightage to a thousandth of a percent, and the
-- extra digits make a simple message look like a system error.
-- =====================================================================
create or replace function validate_assignment(p_assignment_id uuid)
returns table (ok boolean, message text)
language plpgsql stable as $$
declare
  a           kpi_assignments%rowtype;
  job_sum     numeric;
  core_sum    numeric;
  item_count  int;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then
    return query select false, 'Assignment not found'; return;
  end if;

  select
    coalesce(sum(weightage) filter (where section = 'job_role'), 0),
    coalesce(sum(weightage) filter (where section = 'core_values'), 0),
    count(*)
  into job_sum, core_sum, item_count
  from kpi_assignment_items where assignment_id = p_assignment_id;

  if item_count = 0 then
    return query select false, 'No KPI rows have been added'; return;
  end if;

  -- Compared at full precision, reported at one decimal: rounding the
  -- comparison would let 79.999% pass as 80%.
  if job_sum <> a.job_role_weight then
    return query select false, format(
      'Job Role weightages total %s%%, they must total %s%%',
      round(job_sum, 1), round(a.job_role_weight, 1));
    return;
  end if;
  if core_sum <> a.core_values_weight then
    return query select false, format(
      'Core Values weightages total %s%%, they must total %s%%',
      round(core_sum, 1), round(a.core_values_weight, 1));
    return;
  end if;

  return query select true, 'Valid';
end $$;


do $$
declare
  msg text;
begin
  select message into msg from validate_assignment(
    (select a.id from kpi_assignments a
     join kpi_assignment_items i on i.assignment_id = a.id
     group by a.id
     having coalesce(sum(i.weightage) filter (where i.section = 'job_role'), 0) <> 80
     limit 1));

  -- Only assert when there is something invalid to assert against.
  if msg is not null and msg like '%.___%%' then
    raise exception 'weightage message still carries extra decimals: %', msg;
  end if;

  raise notice '0020 self-test passed';
end $$;
