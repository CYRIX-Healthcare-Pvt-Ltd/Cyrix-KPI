-- =====================================================================
-- Cyrix KPI  ·  0252  ·  The people list of a post sent to chosen people
--
-- The user, 5 Nov: E1427 answered Management's form "test", but the
-- post showed "Out of 0 people". 0242 compared each person with the
-- chosen list as `e.id = any ((select audience_ids ...))`, which reads
-- the sub-select as a set of arrays (uuid = uuid[]) and fails, so every
-- post sent to chosen people listed nobody. Now the list is checked
-- against the array itself; a post to everybody (no list) is unchanged.
-- =====================================================================
do $$
declare src text;
begin
  select pg_get_functiondef('digest_post_people(uuid)'::regprocedure) into src;
  if src not like '%e.id = any ((select a.audience_ids from digest_posts a where a.id = p_id)), true)%' then
    raise exception 'digest_post_people is not the 0242 text';
  end if;
  src := replace(src,
    'coalesce(e.id = any ((select a.audience_ids from digest_posts a where a.id = p_id)), true)',
    'coalesce((select e.id = any (a.audience_ids) from digest_posts a where a.id = p_id and a.audience_ids is not null), true)');
  execute src;
end $$;
