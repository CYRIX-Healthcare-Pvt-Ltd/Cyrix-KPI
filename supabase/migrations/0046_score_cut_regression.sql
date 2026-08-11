-- =====================================================================
-- Cyrix KPI  ·  0046  ·  Proving 0045 on data it brings with it
--
-- 0045's self-test needed a submission already scored well below its
-- self assessment, and there isn't one — so it checked the signature and
-- nothing else. The rule is the point of that migration, so it gets a
-- subject built for it: one employee, one KPI, one month with a self
-- score of 90 and a manager score of 70.
--
-- Everything is removed again before the file ends, and the file is one
-- transaction, so a failure leaves nothing behind either way.
-- =====================================================================

do $$
declare
  fy      text;
  mgr     uuid;
  mgr_uid uuid;
  emp     uuid;
  aid     uuid;
  sid     uuid;
  month1  date;
  saved   text;
  refused boolean := false;
begin
  select code, starts_on into fy, month1 from financial_years where is_current;

  -- Somebody who can actually sign in. submit_manager_scores asks
  -- manages_employee(), which resolves through auth.uid() and is plain
  -- false on a connection with no end user — so this test has to run as
  -- a real manager rather than as the migration.
  select id, auth_user_id into mgr, mgr_uid
  from employees where is_active and auth_user_id is not null limit 1;

  if mgr is null then
    raise notice
      '0046 skipped — no active employee has a login to run the check as';
    return;
  end if;

  insert into employees (ecode, full_name, reporting_manager_id, is_active)
  values ('ZZ-0046-PROBE', '0046 score cut probe', mgr, true)
  returning id into emp;

  insert into kpi_assignments (employee_id, financial_year, status, starts_from)
  values (emp, fy, 'active', month1)
  returning id into aid;

  -- No rows on purpose. The row check counts items still missing a
  -- manager value, and none means none missing — which isolates this
  -- test to the one rule it is about. The totals are what the rule
  -- reads, and they are set here rather than computed.
  insert into kpi_submissions (
    assignment_id, employee_id, manager_id, financial_year, period_month,
    status, self_total_score, mgr_total_score)
  values (aid, emp, mgr, fy, month1, 'submitted', 90, 70)
  returning id into sid;

  -- From here on the session is that manager, which is what the rule is
  -- written against. Transaction-local, so it lapses with the file.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', mgr_uid)::text, true);

  -- Twenty points down and silent: refused.
  begin
    perform submit_manager_scores(sid, null);
  exception when others then
    if sqlerrm like 'Your score is % points below%' then
      refused := true;
    else
      raise;
    end if;
  end;

  if not refused then
    raise exception 'a 20 point cut was accepted with no reason given';
  end if;

  -- Whitespace is not a reason.
  refused := false;
  begin
    perform submit_manager_scores(sid, '   ');
  exception when others then
    if sqlerrm like 'Your score is % points below%' then
      refused := true;
    else
      raise;
    end if;
  end;

  if not refused then
    raise exception 'a blank reason was accepted';
  end if;

  -- With one, it goes through and the team member can read it.
  perform submit_manager_scores(sid, 'Two site visits were not completed.');

  select score_cut_reason into saved from kpi_submissions where id = sid;
  if saved is distinct from 'Two site visits were not completed.' then
    raise exception 'the reason was not stored (got %)', coalesce(saved, 'null');
  end if;

  if (select status from kpi_submissions where id = sid) <> 'scored' then
    raise exception 'the month did not reach scored';
  end if;

  -- A gap inside the allowance needs no reason at all.
  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', mgr_total_score = 87, score_cut_reason = null
  where id = sid;
  perform set_config('cyrix.system_write', 'off', true);

  perform submit_manager_scores(sid, null);
  if (select status from kpi_submissions where id = sid) <> 'scored' then
    raise exception 'a 3 point gap was blocked when it should not be';
  end if;

  -- Back to being nobody before clearing up, so the delete is not
  -- subject to whatever that manager may or may not be allowed to do.
  perform set_config('request.jwt.claims', '', true);

  delete from employees where id = emp;
  if exists (select 1 from employees where ecode = 'ZZ-0046-PROBE') then
    raise exception '0046 left its probe employee behind';
  end if;

  raise notice
    '0046 self-test passed — 20 points down was refused twice and '
    'accepted with a reason, 3 points down went through untouched';
end $$;
