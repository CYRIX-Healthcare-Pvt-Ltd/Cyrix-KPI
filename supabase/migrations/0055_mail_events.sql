-- =====================================================================
-- Cyrix KPI  ·  0055  ·  Knowing whether the mail actually arrived
--
-- A code was sent to a real address, the provider returned 2xx, and
-- nothing landed — not in the inbox, not in spam. There was no way to
-- tell the difference between "the provider dropped it", "the recipient
-- server bounced it" and "it is sitting in a quarantine nobody opened",
-- because the only thing this system ever knew was that the API call
-- succeeded.
--
-- Accepting a message is not delivering it. So:
--
--   password_otp.provider_id  the provider's own id for the message, so
--                             a specific send can be looked up rather
--                             than guessed about
--   mail_events               what the provider says happened to it
--                             afterwards, arriving by webhook
--
-- Nothing here trusts the sender of a webhook. The edge function
-- verifies the signature before this is ever called, and record_mail_event
-- is service_role only.
-- =====================================================================

alter table password_otp
  add column if not exists provider_id text;

comment on column password_otp.provider_id is
  'The mail provider''s id for the message carrying this code. Joins to '
  'mail_events, and is what you search for in their dashboard when '
  'somebody says they never got it.';


create table if not exists mail_events (
  id           uuid primary key default gen_random_uuid(),
  /** The provider's message id. Not unique: one message has many events. */
  provider_id  text not null,
  /** delivered, bounced, complained, delivery_delayed, sent … */
  event        text not null,
  recipient    text,
  /** Whose address it was, where we can tell. Null for anything else. */
  employee_id  uuid references employees(id) on delete set null,
  /** The provider's own payload, for the detail no column anticipated. */
  detail       jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_mail_events_message on mail_events (provider_id, occurred_at desc);
create index if not exists idx_mail_events_recent  on mail_events (occurred_at desc);

alter table mail_events enable row level security;

-- Readable by the two roles who administer the system, and nobody else.
-- A row carries an employee's address and the fact that they were sent a
-- password code, which is not a colleague's business.
drop policy if exists mail_events_read on mail_events;
create policy mail_events_read on mail_events for select to authenticated
using (is_hr_admin() or is_sw_admin());

comment on table mail_events is
  'What the mail provider reported about a message after accepting it. '
  'Written only by the mail-events edge function, which verifies the '
  'webhook signature first.';


-- ---------------------------------------------------------------------
-- Recording one.
--
-- Resolves the address to an employee where it can, so the SW Admin
-- screen can say "Kevin Raju" rather than only an address, and so a
-- pattern of bounces against one person is visible.
-- ---------------------------------------------------------------------
create or replace function record_mail_event(
  p_provider_id text,
  p_event       text,
  p_recipient   text,
  p_detail      jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  emp_id uuid;
  new_id uuid;
begin
  if coalesce(trim(p_provider_id), '') = '' or coalesce(trim(p_event), '') = '' then
    raise exception 'A mail event needs a message id and an event name';
  end if;

  select id into emp_id from employees
  where lower(trim(work_email)) = lower(trim(coalesce(p_recipient, '')))
    and work_email is not null
  limit 1;

  insert into mail_events (provider_id, event, recipient, employee_id, detail, occurred_at)
  values (trim(p_provider_id), trim(p_event), lower(nullif(trim(p_recipient), '')),
          emp_id, coalesce(p_detail, '{}'::jsonb), coalesce(p_occurred_at, now()))
  returning id into new_id;

  return new_id;
end $$;

revoke execute on function record_mail_event(text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function record_mail_event(text, text, text, jsonb, timestamptz)
  to service_role;


-- ---------------------------------------------------------------------
-- What SW Admin sees.
--
-- One row per message rather than per event: "sent then delivered" is
-- one message that arrived, and a screen listing both is a screen
-- nobody can count.
-- ---------------------------------------------------------------------
create or replace view v_mail_status
with (security_invoker = true) as
select
  m.provider_id,
  max(m.occurred_at) as last_event_at,
  min(m.occurred_at) as first_seen_at,
  max(m.recipient)   as recipient,
  max(e.full_name)   as full_name,
  max(e.ecode)       as ecode,
  -- The worst thing that happened to it, because that is the thing
  -- somebody needs to act on. Delivered is only the answer when nothing
  -- went wrong afterwards.
  case
    when bool_or(m.event = 'email.bounced')      then 'bounced'
    when bool_or(m.event = 'email.complained')   then 'complained'
    when bool_or(m.event = 'email.delivery_delayed') then 'delayed'
    when bool_or(m.event = 'email.delivered')    then 'delivered'
    when bool_or(m.event = 'email.sent')         then 'sent'
    else max(m.event)
  end as status,
  count(*) as events
from mail_events m
left join employees e on e.id = m.employee_id
group by m.provider_id;

comment on view v_mail_status is
  'One row per message: who it was for and the worst thing that happened '
  'to it. Reading it needs the RLS on mail_events, so HR and SW Admin only.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  ev_id  uuid;
  st     text;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0055-PROBE', 'Probe Person', 'probe.0055@cyrix.in', true)
  returning id into emp_id;

  -- An address on file is resolved to the person behind it.
  ev_id := record_mail_event('msg_a', 'email.sent', 'Probe.0055@Cyrix.IN ',
                             '{"subject":"code"}'::jsonb, now());
  if (select employee_id from mail_events where id = ev_id) is not distinct from null then
    raise exception 'A known address was not matched to its employee';
  end if;
  if (select recipient from mail_events where id = ev_id) <> 'probe.0055@cyrix.in' then
    raise exception 'The recipient was not normalised';
  end if;

  -- An address belonging to nobody is still recorded, just unattached.
  ev_id := record_mail_event('msg_b', 'email.sent', 'stranger@example.com');
  if (select employee_id from mail_events where id = ev_id) is not null then
    raise exception 'An unknown address was attached to somebody';
  end if;

  -- Sent then delivered is one message that arrived.
  perform record_mail_event('msg_a', 'email.delivered', 'probe.0055@cyrix.in');
  select status into st from v_mail_status where provider_id = 'msg_a';
  if st <> 'delivered' then raise exception 'Expected delivered, got %', st; end if;

  -- A bounce after a delivery is what matters, and outranks it.
  perform record_mail_event('msg_a', 'email.bounced', 'probe.0055@cyrix.in');
  select status into st from v_mail_status where provider_id = 'msg_a';
  if st <> 'bounced' then raise exception 'A bounce did not outrank a delivery: %', st; end if;

  -- One row per message, not per event.
  if (select count(*) from v_mail_status where provider_id = 'msg_a') <> 1 then
    raise exception 'A message appeared more than once';
  end if;
  if (select events from v_mail_status where provider_id = 'msg_a') <> 3 then
    raise exception 'Events were not counted';
  end if;

  -- Nonsense is refused rather than stored.
  begin
    perform record_mail_event('  ', 'email.sent', 'probe.0055@cyrix.in');
    raise exception 'A message with no id was accepted';
  exception when others then
    if sqlerrm not like '%needs a message id%' then raise; end if;
  end;

  -- Nobody with a browser may write one.
  if has_function_privilege('anon', 'record_mail_event(text,text,text,jsonb,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'record_mail_event(text,text,text,jsonb,timestamptz)', 'execute') then
    raise exception 'A browser can forge a delivery event';
  end if;

  delete from mail_events where provider_id in ('msg_a', 'msg_b');
  delete from employees where id = emp_id;
  raise notice '0055 self-test passed (events resolve to people, and the worst outcome wins)';
end $$;
