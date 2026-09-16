-- =====================================================================
-- Cyrix KPI  ·  0141  ·  An official number on the employee record
--
-- The employee record had no phone number at all. Revive Lab's route card
-- asks for a contact number on every spare sent in, and without one on the
-- record every engineer typed it again, every time.
--
-- So employees gets official_phone, and the person it belongs to keeps it
-- up to date from My profile — through set_my_official_phone, because the
-- employees row policy lets only HR and SW admin write the table. Their own
-- row, by construction: there is no argument for whose.
--
-- The work email stays as it is — shown on My profile, but set by HR and SW
-- admin (set_my_work_email refuses anybody else), because it is where
-- password codes are sent and cannot be anybody's to change on a whim.
--
-- Stored as digits with an optional leading +, 7 to 15 of them: what the
-- person types is cleaned of spaces and dashes first, so "+91 98470 12345"
-- and "9847012345" are both accepted and both dialable.
-- =====================================================================

alter table public.employees
  add column if not exists official_phone text
  check (official_phone is null or official_phone ~ '^\+?[0-9]{7,15}$');

create or replace function public.set_my_official_phone(p_phone text)
returns text
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_id    uuid := current_employee_id();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if v_id is null then
    raise exception 'There is no employee record behind this login';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'That number does not look right — use digits, with the country code if you like';
  end if;

  update employees set official_phone = v_phone where id = v_id;
  return v_phone;
end $fn$;

grant execute on function public.set_my_official_phone(text) to authenticated;
