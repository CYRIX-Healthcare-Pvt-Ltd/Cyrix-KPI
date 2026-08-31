-- =====================================================================
-- Cyrix KPI  ·  0065  ·  Spare gains a Purchase role, and everybody is active
--
-- Spare has had three roles since it was built: engineer, project manager,
-- admin. Purchasing is a fourth job that was being done by people signed
-- in as one of the other three, which meant the app could not tell you who
-- was allowed to decide what a spare actually is.
--
-- The role is added here and nowhere else. Postgres will not let a new
-- enum value be *used* in the transaction that creates it, so everything
-- that reads or writes 'purchase' lands in 0066 — this file only makes the
-- word exist.
--
-- Also: three engineers were sitting inactive. Sign-in is common across
-- the modules now and is decided by the employee record, so an inactive
-- flag here is a second switch for the same thing, out of step with the
-- first. All three are people HR still lists as employed.
-- =====================================================================

-- `if not exists`, because a migration that has been applied once must be
-- safe to re-read: this is the one DDL in the file and re-running it on a
-- database that already has the value would otherwise abort.
alter type user_role add value if not exists 'purchase';

comment on type user_role is
  'What somebody may do inside Spare. engineer: tags spares and proposes '
  'changes. project_manager: approves them. purchase: decides which Cyrix '
  'item a spare is, and approves that decision for others. admin: the '
  'custom fields, and everything the other three can do.';

-- ─────────────────────────────────────────────────────────────
-- Everybody who works here can sign in
-- ─────────────────────────────────────────────────────────────
-- Only rows whose employee record still says they are employed. This is
-- deliberately not a blanket `set active = true`: the column should agree
-- with HR's record, not overrule it.
update profiles p
set active = true
from employees e
where e.auth_user_id = p.id
  and e.is_active
  and p.active is distinct from true;

-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n integer;
begin
  -- Read from pg_enum rather than comparing against the literal: using
  -- the new value in this transaction is exactly what Postgres forbids,
  -- and the check would fail for a reason that has nothing to do with
  -- whether the migration worked.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'purchase'
  ) then
    raise exception 'user_role is missing the purchase value';
  end if;

  select count(*) into n
  from profiles p
  join employees e on e.auth_user_id = p.id
  where e.is_active and p.active is distinct from true;
  if n <> 0 then
    raise exception '% employed people are still inactive in Spare', n;
  end if;

  raise notice '0065 self-test passed (purchase role exists, employed people are active)';
end $selftest$;
