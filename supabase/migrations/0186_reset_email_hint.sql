-- =====================================================================
-- Cyrix KPI  ·  0186  ·  The email hint on Reset your password
--
-- The user, 13 Oct: "when ecode field is entered, the placeholder mail
-- should be shown but not fully, with *****". The portal's signed-out reset
-- page asks for the employee code and the official email; once a code is
-- typed it shows that person's email with the middle hidden (ke***@cyrix.in),
-- so they know which mailbox the code goes to. Only ever the masked form.
-- =====================================================================

create or replace function email_hint(p_ecode text)
returns text
language sql stable security definer set search_path = public as $$
  select left(split_part(e.work_email, '@', 1), greatest(1, least(2, length(split_part(e.work_email, '@', 1)) - 1)))
         || '***@' || split_part(e.work_email, '@', 2)
  from employees e
  where upper(e.ecode) = upper(btrim(p_ecode)) and e.is_active
    and position('@' in coalesce(e.work_email, '')) > 1
  limit 1
$$;
revoke all on function email_hint(text) from public;
grant execute on function email_hint(text) to anon, authenticated;
