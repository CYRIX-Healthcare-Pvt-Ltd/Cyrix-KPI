-- =====================================================================
-- Cyrix KPI  ·  0089  ·  Asking HR or Software something
--
-- Six request tables already exist and none of them is this. Every one
-- of them is attached to a record and travels up the reporting line: a
-- score query is about one score and goes to your manager, a deletion
-- request is about one month and goes to your manager then HR. There has
-- never been a way to say "my leave balance looks wrong" or "the page
-- will not load", and the answer to both has been to find somebody's
-- desk or their phone number.
--
-- So: unstructured, and routed to a desk rather than to a person in your
-- line. Two desks, because the two questions go to different people and
-- always did -- HR owns the employment record, SW Admin owns the
-- software.
--
-- Deliberately NOT a place to dispute a score. That has its own flow
-- with consequences this one does not have (a query holds the month
-- open until it is answered), and a second door to the same room is how
-- one of them stops being used properly. The form says so and links
-- there instead.
--
-- One answer, then done. Modelled on kpi_score_queries down to the
-- column names -- employee_note, answered_at, answered_by, a response --
-- so somebody who has used one has used the other.
-- =====================================================================

create table if not exists support_tickets (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  -- Who it is for. The two desks are separate queues with separate
  -- readers, and a ticket cannot be moved between them: HR reading a
  -- software complaint is HR reading something they cannot act on.
  desk          text not null check (desk in ('hr', 'software')),
  employee_note text not null check (length(btrim(employee_note)) between 5 and 2000),
  raised_at     timestamptz not null default now(),

  response      text,
  answered_by   uuid references employees(id),
  answered_at   timestamptz,

  -- Derived, not set. Two columns that can disagree about whether a
  -- ticket is answered is a bug waiting for somebody to write the update
  -- that sets one and forgets the other.
  status        text generated always as
                (case when answered_at is null then 'open' else 'answered' end) stored,

  created_at    timestamptz not null default now()
);

create index if not exists support_tickets_desk_open_idx
  on support_tickets (desk, raised_at desc) where answered_at is null;
create index if not exists support_tickets_mine_idx
  on support_tickets (employee_id, raised_at desc);

alter table support_tickets enable row level security;

-- Yours, or your desk's. Nobody sees another person's ticket to the
-- other desk, and HR does not get to read the software queue.
drop policy if exists support_tickets_read on support_tickets;
create policy support_tickets_read on support_tickets
  for select to authenticated
  using (
    employee_id = current_employee_id()
    or (desk = 'hr' and is_hr_admin())
    or (desk = 'software' and is_sw_admin())
  );

-- No insert or update policy on purpose: both go through the functions
-- below, which are where the validation lives.


/**
 * Raise one.
 *
 * The cap is per desk and counts only open tickets, so it limits how
 * many unanswered things one person can have with one desk at a time
 * rather than how many they may ever ask. Somebody with five unanswered
 * questions does not need a sixth; they need an answer.
 */
create or replace function public.raise_support_ticket(p_desk text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := current_employee_id();
  note text := btrim(coalesce(p_note, ''));
  open_now int;
  new_id uuid;
begin
  if me is null then
    raise exception 'Only a signed-in employee can raise a ticket';
  end if;
  if p_desk not in ('hr', 'software') then
    raise exception 'A ticket goes to HR or to Software';
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
end $$;

/**
 * Answer one, which closes it.
 *
 * Only the desk it was sent to. An answer is the whole lifecycle here --
 * there is no reopening and no thread, because a follow-up is a new
 * question and is clearer raised as one.
 */
create or replace function public.answer_support_ticket(p_id uuid, p_response text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t    support_tickets;
  body text := btrim(coalesce(p_response, ''));
begin
  select * into t from support_tickets where id = p_id;
  if t.id is null then
    raise exception 'No such request';
  end if;

  if not ((t.desk = 'hr' and is_hr_admin()) or (t.desk = 'software' and is_sw_admin())) then
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
end $$;

revoke all on function public.raise_support_ticket(text, text)  from public, anon;
revoke all on function public.answer_support_ticket(uuid, text) from public, anon;
grant execute on function public.raise_support_ticket(text, text)  to authenticated;
grant execute on function public.answer_support_ticket(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- The boundaries are the point: a person sees their own, each desk sees
-- only its own queue, and neither desk can answer the other's.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid; emp_u uuid := gen_random_uuid();
  hr_e uuid; hr_u uuid;
  sw_e uuid; sw_u uuid;
  t_hr uuid; t_sw uuid;
  n int;
begin
  select e.id, e.auth_user_id into hr_e, hr_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role in ('hr_admin', 'super_admin') and e.auth_user_id is not null and e.is_active
  limit 1;
  select e.id, e.auth_user_id into sw_e, sw_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role in ('sw_admin', 'super_admin') and e.auth_user_id is not null and e.is_active
  limit 1;
  if hr_e is null or sw_e is null then
    raise notice '0089 self-test skipped (needs an HR admin and an SW admin with logins)';
    return;
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (emp_u, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz0089@cyrix.local', 'x', now(), now());
  insert into employees (ecode, full_name, is_active, auth_user_id)
  values ('ZZ0089', 'Probe', true, emp_u) returning id into emp_id;

  -- As the employee.
  perform set_config('request.jwt.claims',
    json_build_object('sub', emp_u, 'role', 'authenticated')::text, true);

  if (raise_support_ticket('hr', 'My leave balance looks wrong.')->>'ok') <> 'true' then
    raise exception 'An employee could not raise an HR ticket';
  end if;
  perform raise_support_ticket('software', 'The team page will not load on my phone.');

  select id into t_hr from support_tickets where employee_id = emp_id and desk = 'hr';
  select id into t_sw from support_tickets where employee_id = emp_id and desk = 'software';

  if (select status from support_tickets where id = t_hr) <> 'open' then
    raise exception 'A new ticket is not open';
  end if;

  -- Too short is refused rather than stored empty.
  begin
    perform raise_support_ticket('hr', 'eh');
    raise exception 'A two-character ticket was accepted';
  exception when others then
    if sqlerrm not like '%a little more%' then raise; end if;
  end;

  -- An employee cannot answer their own.
  begin
    perform answer_support_ticket(t_hr, 'Sorted it myself.');
    raise exception 'An employee answered their own ticket';
  exception when others then
    if sqlerrm not like '%not on your desk%' then raise; end if;
  end;

  -- HR sees the HR one and not the software one.
  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from support_tickets where id = t_sw;
  if n <> 0 then raise exception 'HR can read the software queue'; end if;
  select count(*) into n from support_tickets where id = t_hr;
  if n <> 1 then raise exception 'HR cannot read its own queue'; end if;

  -- And cannot answer a software ticket.
  perform set_config('role', 'postgres', true);
  begin
    perform answer_support_ticket(t_sw, 'Not mine to answer.');
    raise exception 'HR answered a software ticket';
  exception when others then
    if sqlerrm not like '%not on your desk%' then raise; end if;
  end;

  -- Answering closes it, once.
  perform answer_support_ticket(t_hr, 'Checked with payroll, corrected today.');
  if (select status from support_tickets where id = t_hr) <> 'answered' then
    raise exception 'Answering did not close the ticket';
  end if;
  if (select answered_by from support_tickets where id = t_hr) <> hr_e then
    raise exception 'The answer is not attributed to the person who wrote it';
  end if;
  begin
    perform answer_support_ticket(t_hr, 'Again.');
    raise exception 'A ticket was answered twice';
  exception when others then
    if sqlerrm not like '%already been answered%' then raise; end if;
  end;

  raise notice '0089 self-test passed (two desks, each reading and answering only its own)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
