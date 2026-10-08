-- =====================================================================
-- Cyrix KPI · 0152 · IT is a support desk, like HR and Software
--
-- The user, 8 Oct: "it support also should comes same as hr n sw
-- support, ie a field to enter issue, then submit, so on mail and for it
-- admin new tab ie support rqst like other admins have and reply on that".
--
-- A third desk, 'it'. IT_ADMIN reads and answers it (is_it_admin); the
-- mail goes to the IT_ADMIN record's work_email, it_support@cyrix.in, and
-- the day's round-up has a third kind, digest_it. The three functions are
-- the live definitions with the desk added and nothing else moved.
-- =====================================================================

alter table public.support_tickets drop constraint support_tickets_desk_check;
alter table public.support_tickets add constraint support_tickets_desk_check
  check (desk = any (array['hr', 'software', 'it']));

drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets
  for select to authenticated
  using (
    employee_id = current_employee_id()
    or (desk = 'hr' and is_hr_admin())
    or (desk = 'software' and is_sw_admin())
    or (desk = 'it' and is_it_admin())
  );

alter table public.admin_notifications drop constraint admin_notifications_kind_check;
alter table public.admin_notifications add constraint admin_notifications_kind_check
  check (kind = any (array['support', 'leaver', 'record', 'revision', 'digest_hr', 'digest_sw', 'digest_it']));

CREATE OR REPLACE FUNCTION public.raise_support_ticket(p_desk text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me   uuid := current_employee_id();
  note text := btrim(coalesce(p_note, ''));
  open_now int;
  new_id uuid;
begin
  if me is null then
    raise exception 'Only a signed-in employee can raise a ticket';
  end if;
  if p_desk not in ('hr', 'software', 'it') then
    raise exception 'A ticket goes to HR, Software or IT';
  end if;
  if length(note) < 5 then
    raise exception 'Say a little more about what you need';
  end if;
  if length(note) > 2000 then
    raise exception 'That is too long — keep it under 2000 characters';
  end if;

  select count(*) into open_now
  from support_tickets
  where employee_id = me and desk = p_desk and answered_at is null;

  if open_now >= 5 then
    raise exception
      'You already have % unanswered request(s) with that desk. Wait for a reply first.',
      open_now;
  end if;

  insert into support_tickets (employee_id, desk, employee_note)
  values (me, p_desk, note)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id);
end $function$;

CREATE OR REPLACE FUNCTION public.answer_support_ticket(p_id uuid, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t    support_tickets;
  body text := btrim(coalesce(p_response, ''));
begin
  select * into t from support_tickets where id = p_id;
  if t.id is null then
    raise exception 'No such request';
  end if;

  if not ((t.desk = 'hr' and is_hr_admin()) or (t.desk = 'software' and is_sw_admin())
          or (t.desk = 'it' and is_it_admin())) then
    raise exception 'That request is not on your desk';
  end if;
  if t.answered_at is not null then
    raise exception 'That request has already been answered';
  end if;
  if length(body) < 2 then
    raise exception 'Write an answer before sending it';
  end if;

  update support_tickets
  set response = body, answered_by = current_employee_id(), answered_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.pending_admin_work(p_desk text)
 RETURNS TABLE(kind text, source_id uuid, who text, headline text, detail text, waiting_since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed as (
    select
      -- No end user is a direct connection: a migration, an admin script,
      -- or the service role the round-up mail runs as.
      auth.uid() is null
      or (p_desk = 'hr' and is_hr_admin())
      or (p_desk = 'sw' and is_sw_admin())
      or (p_desk = 'it' and is_it_admin())
      as ok
  ),
  named as (
    select e.id, e.full_name || ' (' || e.ecode || ')' as label from employees e
  )
  select 'support',
         t.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has asked a question',
         left(coalesce(t.employee_note, ''), 300),
         coalesce(t.raised_at, t.created_at)
  from support_tickets t
  left join named n on n.id = t.employee_id
  where (select ok from allowed)
    and t.status = 'open'
    and t.desk = case when p_desk = 'sw' then 'software' when p_desk = 'it' then 'it' else 'hr' end

  union all
  -- Everything below is HR's. The software desk staffs one queue.
  select 'leaver',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has been flagged as having left',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from tm_removal_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending'

  union all
  select 'record',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants a month removed',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from record_deletion_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  union all
  select 'revision',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants their KPI reopened',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from kpi_revision_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  order by 6
$function$;

notify pgrst, 'reload schema';
