-- Find the client items that still need tagging.
--
-- The item master shows Qty, Tagged and Status per row, but it pages a
-- hundred rows at a time through nearly four thousand -- so "show me
-- everything still pending" could not be answered in the browser. It
-- would have filtered the page you happened to be on, and reported a
-- count for it, which is worse than not offering the filter at all.
--
-- The status has to be computed where the paging happens, so it becomes
-- a column. A view rather than a stored count: tagging changes every
-- time somebody scans, and a number kept alongside the item is a number
-- that goes stale the first time an insert forgets to bump it.
--
-- security_invoker so the caller's own RLS still applies to both tables
-- underneath. It is not a way around row level security, only a way to
-- sort and filter by something derived from it.
create or replace view public.bluestar_item_tagging
with (security_invoker = true) as
select
  m.*,
  coalesce(t.tagged_count, 0)::int as tagged_count,
  -- Mirrors taggingStatus() in src/lib/blueStarItem.ts, which still
  -- renders the pill. Change one, change the other: this decides which
  -- rows come back and that decides what they look like, so a
  -- disagreement shows up as a Pending row inside the Completed filter.
  --
  -- No quantity means no denominator, so there is nothing honest to say
  -- about progress. More tags than the quantity is still complete -- it
  -- means the master file is behind, not that the work is unfinished.
  case
    when m.quantity is null or m.quantity <= 0 then 'unknown'
    when coalesce(t.tagged_count, 0) = 0 then 'pending'
    when coalesce(t.tagged_count, 0) >= m.quantity then 'complete'
    else 'partial'
  end as tagging_status
from public.bluestar_item_master m
left join lateral (
  select count(*) as tagged_count
  from public.equipment e
  where e.bluestar_item_id = m.id
    and e.deleted_at is null
) t on true;

-- Signed-in users only, exactly like the table it reads from. anon gets
-- nothing: the view would otherwise be a way to read the catalogue
-- without an account, since a view is a separate grantable object.
revoke all on public.bluestar_item_tagging from anon;
grant select on public.bluestar_item_tagging to authenticated;

notify pgrst, 'reload schema';
