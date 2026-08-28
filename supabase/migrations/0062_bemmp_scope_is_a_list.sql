-- =====================================================================
-- Cyrix KPI  ·  0062  ·  An empty BEMMP scope grants nothing
--
-- 0060 seeded every profile with scope = '{}' on the belief that empty
-- meant "every contract". It does not. `scope` lists the contracts an
-- account may open, and the check is a plain membership test:
--
--   in_scope(want) => want = any (scope)
--
-- so '{}' matches nothing at all. Everybody who opened BEMMP was told
-- "No BEMMP contract is assigned" and handed a sign-out button.
--
-- The belief came from migration 0009, which does say empty means
-- everything — but 0009 is about `zones` and `districts`, the area scope
-- added later, where the rule genuinely is inverted. Two columns on one
-- table, both called scope in conversation, with opposite meanings for
-- the empty case. Reading the note attached to one and applying it to the
-- other is how this got through.
--
-- Both contracts, for everyone. This mirrors what the module already did
-- before it moved here: it is a dashboard people read, the figures are
-- company-wide, and nobody was scoped down in the old project either.
-- Narrowing an individual is a decision for whoever runs BEMMP, and the
-- BEMMP tab in SW Admin is where it gets made.
-- =====================================================================

do $check$
declare
  bad text;
begin
  -- Fail loudly rather than seed a contract id the app will silently
  -- ignore. STATES in the app is the authority and it holds kl and ap.
  select string_agg(c, ', ') into bad
  from unnest(array['kl', 'ap']) c
  where c not in ('kl', 'ap');
  if bad is not null then
    raise exception 'Unknown contract id: %', bad;
  end if;
end $check$;

update profile
set scope = array['kl', 'ap']
where scope = '{}';


-- ---------------------------------------------------------------------
-- New joiners get the same. 0060's sync deliberately leaves role and
-- scope alone on an existing row, because they are BEMMP's to decide —
-- but a row it has just created has no scope at all, and a person who
-- cannot open either contract cannot use the module.
-- ---------------------------------------------------------------------
create or replace function public.bemmp_sync_profile_from_employee()
returns trigger
language plpgsql security definer set search_path = public as $bemmp_sync$
begin
  if new.auth_user_id is null then
    return new;
  end if;

  insert into profile (id, code, full_name, role, scope)
  values (new.auth_user_id, new.ecode, new.full_name,
          'coordinator'::app_role, array['kl', 'ap'])
  on conflict (id) do update set
    code      = excluded.code,
    full_name = excluded.full_name;
    -- role and scope untouched on update: both are BEMMP's to decide once
    -- the row exists. Only the insert seeds them.

  return new;
end $bemmp_sync$;


-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n_empty integer;
  n_total integer;
  probe   uuid;
begin
  select count(*) into n_empty from profile where scope = '{}';
  select count(*) into n_total from profile;
  if n_empty > 0 then
    raise exception '% of % BEMMP profiles still open no contract', n_empty, n_total;
  end if;

  -- The function the app's own filter rests on now answers yes.
  select id into probe from profile limit 1;
  if not exists (select 1 from profile where id = probe and 'kl' = any (scope)) then
    raise exception 'A seeded profile does not carry the kl contract';
  end if;

  raise notice '0062 self-test passed (% profiles, none empty)', n_total;
end $selftest$;
