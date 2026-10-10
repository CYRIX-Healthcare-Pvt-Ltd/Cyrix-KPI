-- =====================================================================
-- Cyrix KPI  ·  0159  ·  Who a message went to, and whose history it is
--
-- The user, 10 Oct: show the recipients; a history of what was sent;
-- and "SW Admin sent cannot be seen by HR and vice versa, with the
-- recipients list". A message is sent as HR or as SW Admin (sent_as),
-- from that desk's own page, and only that desk sees it afterwards.
-- The automatic reminders belong to both.
-- =====================================================================

alter table push_messages add column if not exists sent_as text check (sent_as in ('hr', 'sw'));

-- May the caller send, or read, as this desk?
create or replace function push_desk_ok(p_as text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case p_as when 'hr' then is_hr_admin() when 'sw' then is_sw_admin() else false end
$$;
grant execute on function push_desk_ok(text) to authenticated;

drop policy if exists push_messages_read on push_messages;
create policy push_messages_read on push_messages for select to authenticated
  using (
    (kind = 'reminder' and (is_hr_admin() or is_sw_admin()))
    or (sent_as is not null and push_desk_ok(sent_as))
  );

-- Who a message went to: whether they have read it in the bell, and how
-- many devices they have. Only for a message the caller can see.
create or replace function push_recipients(p_message uuid)
returns table (ecode text, full_name text, read boolean, devices int)
language plpgsql stable security definer set search_path = public as $$
declare m push_messages%rowtype;
begin
  select * into m from push_messages where id = p_message;
  if not found or not (
    (m.kind = 'reminder' and (is_hr_admin() or is_sw_admin()))
    or (m.sent_as is not null and push_desk_ok(m.sent_as))) then
    raise exception 'Not yours to see';
  end if;
  return query
  select e.ecode, e.full_name, i.read_at is not null,
         (select count(*)::int from push_subscriptions s where s.employee_id = e.id)
  from push_inbox i join employees e on e.id = i.employee_id
  where i.message_id = p_message
  order by e.full_name;
end $$;
grant execute on function push_recipients(uuid) to authenticated;

-- Who a target reaches, by name, before sending.
create or replace function push_audience_people(p_target jsonb)
returns table (ecode text, full_name text, devices int)
language sql stable security definer set search_path = public as $$
  select e.ecode, e.full_name, (select count(*)::int from push_subscriptions s where s.employee_id = e.id)
  from push_audience(p_target) a join employees e on e.id = a.employee_id
  order by e.full_name
$$;
grant execute on function push_audience_people(jsonb) to authenticated;
