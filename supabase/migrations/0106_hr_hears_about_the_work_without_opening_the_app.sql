-- =====================================================================
-- Cyrix KPI  ·  0106  ·  HR hears about the work without opening the app
--
-- Management: when a support question, a leaver, a record deletion or a
-- KPI revision arrives for HR, HR Admin is emailed, with a link straight
-- to the screen it is waiting on. HR Admin chooses who else is copied.
--
-- Four queues have badges nobody sees unless they are already signed in.
-- Two of them -- Leavers and Records -- are somebody else waiting on HR,
-- and the wait is measured in days when nobody logs in over a weekend.
--
-- Software-desk support tickets deliberately send nothing: SW Admin
-- watches that queue, and adding it here would put every "I cannot sign
-- in" into HR's inbox.
--
-- WHY A LEDGER RATHER THAN A FLAG ON EACH TABLE
--
-- There is no pg_net and no pg_cron on this project, so the database
-- cannot call out and nothing can drain a queue on a timer. The only
-- path available is the one password codes already take: the browser
-- asks an edge function to send. That means the send can be attempted
-- more than once -- a retry, a double click, two tabs -- and the unique
-- (kind, source_id) below is what makes the second attempt a no-op
-- instead of a second email. Claiming the row IS the lock.
--
-- It also leaves a record of what was sent and what failed, which a flag
-- on the source row would not: an email nobody can prove was sent is the
-- same as one that was not.
-- =====================================================================

create table if not exists admin_notifications (
  id         uuid primary key default gen_random_uuid(),
  -- 'support' is the HR desk only. See the note above.
  kind       text not null check (kind in ('support', 'leaver', 'record', 'revision')),
  source_id  uuid not null,
  /** Null while claimed but not yet away, so a failure is visible. */
  sent_at    timestamptz,
  recipients text[],
  error      text,
  created_at timestamptz not null default now(),
  unique (kind, source_id)
);

comment on table admin_notifications is
  'One row per admin email attempted. The unique key is the lock that '
  'stops a retry sending twice. See 0106.';

alter table admin_notifications enable row level security;

-- Nobody writes this from a browser: the edge function holds the service
-- role and bypasses RLS. Reading is for the two admins, so a "did that
-- go out?" question has an answer.
drop policy if exists admin_notifications_read on admin_notifications;
create policy admin_notifications_read on admin_notifications
  for select using (is_hr_admin() or is_sw_admin());

-- ---------------------------------------------------------------------
-- Who else is copied.
-- ---------------------------------------------------------------------
insert into app_settings (key, value, description)
values (
  'hr_notify_cc',
  '[]'::jsonb,
  'Addresses copied on every HR notification, set by HR Admin. Empty '
  'means HR Admin alone. Official @cyrix.in addresses only.'
)
on conflict (key) do nothing;

/**
 * HR Admin decides who else hears about it.
 *
 * A list rather than a role lookup: HR Department has some twenty people
 * in it and almost none of them want every support question. Starting
 * empty and letting HR add colleagues means nobody is subscribed to
 * anything they did not ask for.
 */
create or replace function set_hr_notify_cc(p_cc text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text[] := '{}';
  one     text;
begin
  if not is_hr_admin() then
    raise exception 'Only HR Admin can change who is copied';
  end if;

  foreach one in array coalesce(p_cc, '{}'::text[])
  loop
    one := lower(btrim(one));
    continue when one = '';
    -- The domain must EQUAL cyrix.in, not merely end with it -- see
    -- lib/officialEmail.ts for why notcyrix.in is the case that matters.
    if one !~ '^[^@[:space:]<>,]+@cyrix[.]in$' then
      raise exception 'Use official @cyrix.in addresses only, not %', one;
    end if;
    if not (one = any(cleaned)) then
      cleaned := cleaned || one;
    end if;
  end loop;

  -- A ceiling, because the box is a paste target and a notification list
  -- that grew to the whole company would be discovered by the company.
  if array_length(cleaned, 1) > 10 then
    raise exception 'Ten addresses at most. Use a distribution list beyond that';
  end if;

  update app_settings
  set value = to_jsonb(cleaned), updated_at = now()
  where key = 'hr_notify_cc';

  perform log_audit('app_settings', null, 'hr_notify_cc_changed',
                    jsonb_build_object('cc', to_jsonb(cleaned)));
  return to_jsonb(cleaned);
end $$;

revoke all on function set_hr_notify_cc(text[]) from public;
grant execute on function set_hr_notify_cc(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  hr_auth  uuid;
  emp_auth uuid;
  refused  boolean;
  got      jsonb;
  claimed  uuid;
  again    uuid;
begin
  select auth_user_id into hr_auth from employees where ecode = 'HR_ADMIN';
  select auth_user_id into emp_auth from employees where ecode = 'E8888';
  if hr_auth is null or emp_auth is null then
    raise notice '0106 self-test skipped (HR_ADMIN or E8888 has no login)';
    return;
  end if;

  -- 1. An ordinary employee cannot set the list.
  perform set_config('request.jwt.claims',
    json_build_object('sub', emp_auth, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform set_hr_notify_cc(array['someone@cyrix.in']);
  exception when others then
    if sqlerrm like '%Only HR Admin%' then refused := true; else raise; end if;
  end;
  if not refused then raise exception 'an employee set the CC list'; end if;

  -- 2. HR Admin cannot add a personal or lookalike address.
  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_auth, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform set_hr_notify_cc(array['a@cyrix.in', 'b@notcyrix.in']);
  exception when others then
    if sqlerrm like '%official @cyrix.in%' then refused := true; else raise; end if;
  end;
  if not refused then raise exception 'accepted a lookalike domain'; end if;

  -- 3. Trimmed, lowercased, de-duplicated, blanks dropped.
  got := set_hr_notify_cc(array['  One@Cyrix.IN ', 'one@cyrix.in', '', 'two@cyrix.in']);
  if got <> '["one@cyrix.in", "two@cyrix.in"]'::jsonb then
    raise exception 'expected two tidy addresses, got %', got;
  end if;

  -- 4. Claiming a notification twice yields one row.
  insert into admin_notifications (kind, source_id)
  values ('leaver', '00000000-0000-0000-0000-000000000001')
  on conflict (kind, source_id) do nothing
  returning id into claimed;
  insert into admin_notifications (kind, source_id)
  values ('leaver', '00000000-0000-0000-0000-000000000001')
  on conflict (kind, source_id) do nothing
  returning id into again;
  if claimed is null then raise exception 'the first claim did not take'; end if;
  if again is not null then raise exception 'the second claim sent a second email'; end if;

  raise notice '0106 self-test passed (refusals, tidying, claim is a lock)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
