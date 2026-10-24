-- =====================================================================
-- Cyrix KPI  ·  0222  ·  a task for a later day is news at 9 AM that day; its mail goes then
--
-- With mt_0010 an assigned task reaches the person at 9 AM on its day: the device notification waits for that too,
-- and task-mail (every 5 minutes, the push key) sends the one mail for it.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.push_bell_due()
 RETURNS TABLE(employee_id uuid, kind text, n integer, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r  record;
  f  record;
  st push_bell_state%rowtype;
  kinds text[];
begin
  -- Revive Lab, worked out once for everybody.
  drop table if exists _rw;
  create temp table _rw on commit drop as select * from revive_waiting_now();

  for r in
    select distinct e.id, e.auth_user_id
    from push_subscriptions s join employees e on e.id = s.employee_id
    where e.is_active and e.auth_user_id is not null
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    kinds := '{}';
    for f in
      select x.kind, x.n, x.latest, null::text as detail from my_notifications() x
      union all
      select 'revive', count(distinct w.ticket_id)::int, max(w.at),
             (select string_agg(y.code || ' · ' || y.why, ', ' order by y.at desc)
              from (select * from _rw z where z.employee_id = r.id order by z.at desc limit 3) y)
      from _rw w where w.employee_id = r.id
      having count(*) > 0
      union all
      select 'revive_team', count(*)::int, max(t.created_at),
             (select split_part(m.full_name, ' ', 1) || ' raised ' || tt.code || coalesce(' · ' || nullif(tt.spare_name, ''), '')
              from revive_tickets tt join employees m on m.id = tt.raised_by
              where m.reporting_manager_id = r.id and tt.created_at > now() - interval '30 days'
              order by tt.created_at desc limit 1)
      from revive_tickets t join employees m on m.id = t.raised_by
      where m.reporting_manager_id = r.id and t.created_at > now() - interval '30 days'
      having count(*) > 0
      union all
      -- My Task (0220): what the manager did on this person's tasks, not opened yet — a task assigned, a reminder…
      select 'tasks', count(distinct e.task_id)::int, max(e.at),
             (select split_part(coalesce(b.full_name, 'Your manager'), ' ', 1) || ' ' || case e2.kind
                when 'assigned' then 'assigned you' when 'reminder' then 'sent a reminder on' when 'sent_back' then 'sent back'
                when 'approved' then 'approved' when 'reopened' then 'reopened' when 'due' then 'changed the due date of'
                when 'criticality' then 'changed how critical' when 'comment' then 'commented on'
                when 'progress' then coalesce(e2.note, 'updated progress') || ' on' when 'done' then 'completed' else 'changed' end
              || ' · ' || t2.title
              from task_events e2 join task_items t2 on t2.id = e2.task_id left join employees b on b.id = e2.by_id
              where t2.employee_id = r.id and e2.seen_at is null and (t2.assigned_by is null or ((t2.due_on + time '09:00') at time zone 'Asia/Kolkata') <= now()) and e2.by_id is distinct from r.id and e2.kind in ('assigned', 'reminder', 'sent_back', 'approved', 'reopened', 'due', 'criticality', 'comment')
              order by e2.at desc limit 1)
      from task_events e join task_items t on t.id = e.task_id
      where t.employee_id = r.id and e.seen_at is null and (t.assigned_by is null or ((t.due_on + time '09:00') at time zone 'Asia/Kolkata') <= now()) and e.by_id is distinct from r.id and e.kind in ('assigned', 'reminder', 'sent_back', 'approved', 'reopened', 'due', 'criticality', 'comment')
      having count(*) > 0
      union all
      -- …and, to the manager who assigned a task, the person's progress, completion and comments on it.
      select 'tasks_team', count(distinct e.task_id)::int, max(e.at),
             (select split_part(coalesce(b.full_name, 'Your manager'), ' ', 1) || ' ' || case e2.kind
                when 'assigned' then 'assigned you' when 'reminder' then 'sent a reminder on' when 'sent_back' then 'sent back'
                when 'approved' then 'approved' when 'reopened' then 'reopened' when 'due' then 'changed the due date of'
                when 'criticality' then 'changed how critical' when 'comment' then 'commented on'
                when 'progress' then coalesce(e2.note, 'updated progress') || ' on' when 'done' then 'completed' else 'changed' end
              || ' · ' || t2.title
              from task_events e2 join task_items t2 on t2.id = e2.task_id left join employees b on b.id = e2.by_id
              where t2.assigned_by = r.id and e2.by_id = t2.employee_id and e2.seen_at is null and e2.kind in ('progress', 'done', 'comment')
              order by e2.at desc limit 1)
      from task_events e join task_items t on t.id = e.task_id
      where t.assigned_by = r.id and e.by_id = t.employee_id and e.seen_at is null and e.kind in ('progress', 'done', 'comment')
      having count(*) > 0
    loop
      kinds := kinds || f.kind;
      select * into st from push_bell_state b where b.employee_id = r.id and b.kind = f.kind;
      if not found
         or f.n > st.n
         or coalesce(f.latest, '-infinity') > coalesce(st.latest, '-infinity') then
        employee_id := r.id; kind := f.kind; n := f.n; detail := f.detail;
        return next;
      end if;
      insert into push_bell_state as b (employee_id, kind, n, latest)
      values (r.id, f.kind, f.n, f.latest)
      on conflict on constraint push_bell_state_pkey do update set n = excluded.n, latest = excluded.latest;
    end loop;
    delete from push_bell_state b where b.employee_id = r.id and not (b.kind = any (kinds));
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.push_seed_revive(p_employee uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'revive', count(distinct ticket_id)::int, max(at)
  from revive_waiting_now() where employee_id = p_employee
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'revive_team', count(*)::int, max(t.created_at)
  from revive_tickets t join employees m on m.id = t.raised_by
  where m.reporting_manager_id = p_employee and t.created_at > now() - interval '30 days'
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
  -- My Task's updates already there are not news to a new device either (0220).
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'tasks', count(distinct e.task_id)::int, max(e.at)
  from task_events e join task_items t on t.id = e.task_id
  where t.employee_id = p_employee and e.seen_at is null and (t.assigned_by is null or ((t.due_on + time '09:00') at time zone 'Asia/Kolkata') <= now()) and e.by_id is distinct from p_employee and e.kind in ('assigned', 'reminder', 'sent_back', 'approved', 'reopened', 'due', 'criticality', 'comment')
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
  insert into push_bell_state (employee_id, kind, n, latest)
  select p_employee, 'tasks_team', count(distinct e.task_id)::int, max(e.at)
  from task_events e join task_items t on t.id = e.task_id
  where t.assigned_by = p_employee and e.by_id = t.employee_id and e.seen_at is null and e.kind in ('progress', 'done', 'comment')
  having count(*) > 0
  on conflict (employee_id, kind) do nothing;
$function$
;

create or replace function task_mail_call()
returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url     := 'https://emuvmihfbnndhbpsndvc.supabase.co/functions/v1/task-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_reminder_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$;
revoke execute on function task_mail_call() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'task-mail';
select cron.schedule('task-mail', '*/5 * * * *', $$select public.task_mail_call()$$);
