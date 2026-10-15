-- Every HR report counts employees only (the user, 15 Oct: "for all reports same should be like
-- only employee"): test and admin logins (0203) are left out of the KPI report, manager
-- completion and manager TAT. The unfiltered rows stay as v_kpi_report_rows_all.
alter view public.v_kpi_report_rows rename to v_kpi_report_rows_all;
create view public.v_kpi_report_rows with (security_invoker = true) as
  select r.* from public.v_kpi_report_rows_all r
  where r.employee_id in (select id from public.employees where account_type = 'employee')
    and (r.manager_id is null or r.manager_id in (select id from public.employees where account_type = 'employee'));
grant select on public.v_kpi_report_rows to authenticated;

create or replace view public.v_manager_completion with (security_invoker = true) as
 SELECT m.id AS manager_id,
    m.ecode AS manager_ecode,
    m.full_name AS manager_name,
    m.department,
    count(t.employee_id) AS team_size,
    count(*) FILTER (WHERE (t.kpi_status = 'active'::text)) AS kpi_approved,
    count(*) FILTER (WHERE (t.kpi_status = 'pending_approval'::text)) AS kpi_awaiting_approval,
    count(*) FILTER (WHERE (t.kpi_status = 'not_set_up'::text)) AS kpi_not_set_up,
    sum(t.months_awaiting_manager) AS months_awaiting_score,
    round(avg(t.avg_score), 2) AS team_avg_score
   FROM (employees m
     JOIN v_org_kpi_status t ON ((t.reporting_manager_id = m.id)))
  WHERE m.is_active AND m.account_type = 'employee' AND t.employee_id IN (SELECT id FROM employees WHERE account_type = 'employee')
  GROUP BY m.id, m.ecode, m.full_name, m.department;

create or replace view public.v_manager_tat with (security_invoker = true) as
 SELECT s.manager_id,
    m.ecode AS manager_ecode,
    m.full_name AS manager_name,
    s.financial_year,
    count(*) AS months_handled,
    round(avg((EXTRACT(epoch FROM (s.manager_scored_at - s.self_submitted_at)) / (86400)::numeric)), 1) AS avg_days_to_score,
    round(avg((EXTRACT(epoch FROM (s.finalized_at - s.self_submitted_at)) / (86400)::numeric)), 1) AS avg_days_to_finalize,
    count(*) FILTER (WHERE (s.status = 'submitted'::text)) AS still_awaiting_score,
    (max((EXTRACT(epoch FROM (now() - s.self_submitted_at)) / (86400)::numeric)))::numeric(10,1) AS oldest_pending_days
   FROM (kpi_submissions s
     LEFT JOIN employees m ON ((m.id = s.manager_id)))
  WHERE (s.self_submitted_at IS NOT NULL) AND s.employee_id IN (SELECT id FROM employees WHERE account_type = 'employee') AND (s.manager_id IS NULL OR s.manager_id IN (SELECT id FROM employees WHERE account_type = 'employee'))
  GROUP BY s.manager_id, m.ecode, m.full_name, s.financial_year;
