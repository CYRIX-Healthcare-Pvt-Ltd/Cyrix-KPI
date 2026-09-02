-- =====================================================================
-- Cyrix KPI  ·  0084  ·  Codes come from the domain that still exists
--
-- Two things are wrong with the sender, and both of them silently break
-- every password reset in the company.
--
-- The domain. send.cyrix.in was verified with a Resend account that has
-- since been deleted, and a deleted account takes its DKIM key with it —
-- so the address is not merely unverified, it is unverifiable, and every
-- send is rejected at the provider before it reaches anybody. The new
-- account verifies updates.cyrix.in. Still a subdomain, for the reason
-- 0052 gave: verifying cyrix.in itself would put an SPF record beside
-- the one Microsoft 365 relies on for the whole company.
--
-- The name. "Cyrix KPI" was true when KPI owned the reset screen. It no
-- longer does — recovery moved to the portal, because a forgotten
-- password locks somebody out of all four modules and the front door is
-- the only screen they share. A code that arrives from "Cyrix KPI" when
-- you were signing in to Spare reads as the wrong email, and the one
-- thing a one-time code must never look like is a phish.
--
-- Conditional on the old domain, so a value SW Admin has already set to
-- something deliberate is left alone. SW Admin still owns this field and
-- can change it back from the settings screen at any time; this only
-- moves it off an address that cannot work.
-- =====================================================================

update app_settings
set value = to_jsonb('Cyrix <no-reply@updates.cyrix.in>'::text),
    updated_at = now()
where key = 'otp_from'
  and value #>> '{}' like '%@send.cyrix.in%';

-- A fresh environment seeds from 0052 and is corrected by the statement
-- above, so the only way to be left on the dead domain is to have set it
-- there on purpose. The description is restated because it names the
-- domain, and a description that names the wrong one is how the next
-- person talks themselves out of a correct value.
update app_settings
set description =
  'The From address on password reset and change codes. Must be at a '
  'domain verified with the mail provider, or every send is rejected. '
  'Currently updates.cyrix.in. Deliberately a subdomain: verifying '
  'cyrix.in itself would put an SPF record beside the one Microsoft 365 '
  'relies on for the whole company. Neutral display name, because the '
  'reset screen serves every module and not just KPI.'
where key = 'otp_from';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  got text;
begin
  got := otp_sender();

  if got is null then
    raise exception 'There is no sender address at all';
  end if;

  -- The thing this migration exists to guarantee.
  if got like '%send.cyrix.in%' then
    raise exception 'The sender is still on the dead domain: %', got;
  end if;
  if got not like '%@updates.cyrix.in%' then
    raise exception 'The sender is not on the verified domain: %', got;
  end if;

  -- And it is still a shape the provider will accept, which is the same
  -- test set_otp_from applies. A correct domain in a malformed header is
  -- no better than a dead one.
  if not (got ~ '^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$'
          or got ~ '^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$') then
    raise exception 'The sender is not a valid From header: %', got;
  end if;

  -- No stray quoting: otp_sender() reads the jsonb out as text, and a
  -- value written as a JSON string rather than with to_jsonb would come
  -- back wrapped and be rejected by the provider as an address.
  if got like '"%' then
    raise exception 'The sender came back as a quoted JSON string: %', got;
  end if;

  raise notice '0084 self-test passed (codes come from %)', got;
end $$;
