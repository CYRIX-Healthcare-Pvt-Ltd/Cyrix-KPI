-- =====================================================================
-- Cyrix KPI  ·  0271  ·  A message can carry a picture
--
-- The Google Maps screenshot notice for Travel shows the box people will see
-- (the user, 9 Nov: "can we add image of that container in notification?").
-- The picture is an address on app.cyrix.in: the bell shows it under the
-- text, and Android and computer notifications show it large (iPhone web
-- notifications are text only).
-- =====================================================================

alter table push_messages add column if not exists image text;

drop function if exists my_app_messages(text);
create function my_app_messages(p_app text)
returns table (id uuid, title text, body text, url text, created_at timestamptz, unread boolean, image text)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.body, m.url, m.created_at, i.read_at is null, m.image
  from push_inbox i join push_messages m on m.id = i.message_id
  where i.employee_id = current_employee_id()
    and i.dismissed_at is null
    and m.created_at > now() - interval '30 days'
    and coalesce(m.target->>'kind', '') <> 'digest'
    and message_app(m.url) = p_app
  order by m.created_at desc
  limit 20
$$;
revoke all on function my_app_messages(text) from public, anon;
grant execute on function my_app_messages(text) to authenticated;
