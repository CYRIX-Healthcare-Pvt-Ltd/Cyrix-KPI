-- Who a draft was sent to as a test, so editing it again shows them (the user, 13 Oct).
create or replace function digest_testers(p_id uuid)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.ecode order by e.ecode), '{}')
  from digest_posts p join employees e on e.id = any (p.testers)
  where p.id = p_id and digest_can_edit(p.id);
$$;
revoke all on function digest_testers(uuid) from public, anon;
grant execute on function digest_testers(uuid) to authenticated;
