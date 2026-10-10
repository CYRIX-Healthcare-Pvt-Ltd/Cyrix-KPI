-- =====================================================================
-- Cyrix KPI  ·  0158  ·  A message lands in the bell too
--
-- The user, 10 Oct: "if device not enabled also we can send to app
-- notification". A message from HR or SW Admin goes into the bell of
-- every person it is for (push_inbox), and to their devices on top of
-- that where notifications are on. The bell shows the message itself;
-- opening the bell reads it; it can be cleared; after 30 days it drops off.
-- =====================================================================

create table if not exists push_inbox (
  message_id   uuid not null references push_messages(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  read_at      timestamptz,
  dismissed_at timestamptz,
  primary key (message_id, employee_id)
);
create index if not exists push_inbox_employee on push_inbox(employee_id);
alter table push_inbox enable row level security;
-- No policies: through the functions below only.

create or replace function my_messages()
returns table (id uuid, title text, body text, created_at timestamptz, unread boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.body, m.created_at, i.read_at is null
  from push_inbox i join push_messages m on m.id = i.message_id
  where i.employee_id = current_employee_id()
    and i.dismissed_at is null
    and m.created_at > now() - interval '30 days'
  order by m.created_at desc
  limit 20
$$;

create or replace function mark_messages_read()
returns void
language sql security definer set search_path = public as $$
  update push_inbox set read_at = now()
  where employee_id = current_employee_id() and read_at is null
$$;

create or replace function dismiss_message(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update push_inbox set dismissed_at = now(), read_at = coalesce(read_at, now())
  where employee_id = current_employee_id() and message_id = p_id
$$;

grant execute on function my_messages() to authenticated;
grant execute on function mark_messages_read() to authenticated;
grant execute on function dismiss_message(uuid) to authenticated;
