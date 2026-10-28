/*
  0226 — with the screens for 0225's core value parts. Every month not yet scored on a KPI that rates its own core
  values gets the parts, and a submitted one goes back to draft to rate them and send again (the user, 28 Oct:
  "revert to draft, which ajith hasnt scored" … "ya all unscored months"). Each person whose months went back is
  told, from SW Admin, in their notifications ("just given them a notification also saying kpi reverted back bcz
  core values to be filled").
*/
-- ---------------------------------------------------------------------------------------------------------------
-- Every month not yet scored on a KPI that rates its own core values: the parts now, and a submitted month back to
-- draft to rate them and send again (the user, 28 Oct: "revert to draft, which ajith hasnt scored").
create temp table core_parts_moved (employee_id uuid, period_month date) on commit drop;
do $do$
declare r record;
begin
  for r in
    select s.id, s.status, s.employee_id, s.period_month from kpi_submissions s join kpi_assignments a on a.id = s.assignment_id
    where a.core_self_rating and s.status in ('draft', 'returned', 'submitted')
  loop
    perform ensure_core_parts(r.id);
    if r.status = 'submitted' then
      perform set_config('cyrix.system_write', 'on', true);
      update kpi_submissions set status = 'draft', self_submitted_at = null where id = r.id;
      perform set_config('cyrix.system_write', 'off', true);
      perform log_audit('kpi_submission', r.id, 'core_parts_to_draft', jsonb_build_object('was', r.status));
      insert into core_parts_moved values (r.employee_id, r.period_month);
    end if;
  end loop;
end $do$;

-- One message each, naming their months, as SW Admin's Send tab would write it.
do $do$
declare r record; mid uuid;
begin
  for r in
    select m.employee_id, e.ecode,
           string_agg(to_char(m.period_month, 'Mon-YY'), ', ' order by m.period_month) as months,
           count(*) as n
    from core_parts_moved m join employees e on e.id = m.employee_id
    group by m.employee_id, e.ecode
  loop
    insert into push_messages (kind, title, body, url, target, sent_by, sent_as, people, devices, delivered, failed)
    values ('manual',
            case when r.n = 1 then 'Your KPI month is back with you' else 'Your KPI months are back with you' end,
            'Core values are now rated in parts. Fill them in for ' || r.months || ' and submit again.',
            '/kpi/history',
            jsonb_build_object('kind', 'person', 'values', jsonb_build_array(r.ecode)),
            (select ur.employee_id from user_roles ur where ur.role = 'sw_admin' limit 1),
            'sw', 1, 0, 0, 0)
    returning id into mid;
    insert into push_inbox (message_id, employee_id) values (mid, r.employee_id);
  end loop;
end $do$;
