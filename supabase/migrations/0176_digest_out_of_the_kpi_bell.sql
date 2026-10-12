-- =====================================================================
-- Cyrix KPI  ·  0176  ·  Cyrix Digest posts stay out of the KPI bell
--
-- The user, 12 Oct: "keep digest out of kpi bell". A post is on the portal
-- home and goes to devices; the bell is for KPI's own messages. The push
-- function no longer puts posts in the inbox, and the bell leaves out the
-- ones already there.
-- =====================================================================

create or replace function my_messages()
returns table (id uuid, title text, body text, created_at timestamptz, unread boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.body, m.created_at, i.read_at is null
  from push_inbox i join push_messages m on m.id = i.message_id
  where i.employee_id = current_employee_id()
    and i.dismissed_at is null
    and m.created_at > now() - interval '30 days'
    and coalesce(m.target->>'kind', '') <> 'digest'
  order by m.created_at desc
  limit 20
$$;
