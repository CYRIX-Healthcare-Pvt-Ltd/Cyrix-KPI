-- =====================================================================
-- Cyrix KPI  ·  0250  ·  Each module's bell shows its own messages
--
-- The user, 5 Nov: "i dont want other modules notiifcation in other
-- modules, better add bell for travel module." A Travel advance was in
-- KPI's bell. A message belongs to the module its link opens:
--   kpi     a link into /kpi, or none / '/' (HR's and SW Admin's messages)
--   travel  a link into /travel
-- Anything else (Ops alerts, BEMMP, new-module notices) is in no bell;
-- it still reaches the phone. Opening a bell marks only its own read.
-- my_messages() and mark_messages_read() stay as they were until the
-- apps move over.
-- =====================================================================

create or replace function message_app(p_url text)
returns text
language sql immutable as $$
  select case
    when coalesce(p_url, '') in ('', '/') or p_url like '/kpi%' then 'kpi'
    when p_url like '/travel%' then 'travel'
  end
$$;

create or replace function my_app_messages(p_app text)
returns table (id uuid, title text, body text, url text, created_at timestamptz, unread boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.body, m.url, m.created_at, i.read_at is null
  from push_inbox i join push_messages m on m.id = i.message_id
  where i.employee_id = current_employee_id()
    and i.dismissed_at is null
    and m.created_at > now() - interval '30 days'
    and coalesce(m.target->>'kind', '') <> 'digest'
    and message_app(m.url) = p_app
  order by m.created_at desc
  limit 20
$$;

create or replace function mark_app_messages_read(p_app text)
returns void
language sql security definer set search_path = public as $$
  update push_inbox i set read_at = now()
  from push_messages m
  where m.id = i.message_id and i.employee_id = current_employee_id() and i.read_at is null
    and message_app(m.url) = p_app
$$;

revoke all on function my_app_messages(text) from public, anon;
revoke all on function mark_app_messages_read(text) from public, anon;
grant execute on function my_app_messages(text) to authenticated;
grant execute on function mark_app_messages_read(text) to authenticated;

revoke all on function message_app(text) from public, anon;
grant execute on function message_app(text) to authenticated;
