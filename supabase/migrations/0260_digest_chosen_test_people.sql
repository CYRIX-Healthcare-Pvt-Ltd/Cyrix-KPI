-- Cyrix KPI  ·  0260  ·  Who answered: named test accounts counted; a test's answers shown, then cleared at publishing
--
-- The user, 6 Nov:
--   * Tincy sent a quiz to Henry (E9999) alone; Henry answered 3 of 4, but her list said Answered 0, because the
--     people list keeps to account_type 'employee' and Henry is a test account. Named in Send to, a test account
--     is now counted like anyone else; sent to everyone, a function or a team, test accounts stay out as before.
--   * "before that she send test to ticny and kevin, and submitted but that result not shown anywhere, i should
--     show, once it is publuished remove the test datas": a draft sent as a test lists its testers, with their
--     answers and scores; publishing it clears everything the test left (answers, scores, votes, opens, likes,
--     comments, join clicks, video views, quiz starts), so the real count starts at 0.

-- The people list: a draft's testers; else the chosen people (test accounts too); else employees.
do $$
declare f text; was text;
begin
  f := replace(pg_get_functiondef('public.digest_post_people(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('0260' in f) > 0 then return; end if;
  was := $w$  where e.is_active and e.account_type = 'employee'
    -- Sent to chosen people (0235): out of them.
    and coalesce((select e.id = any (a.audience_ids) from digest_posts a where a.id = p_id and a.audience_ids is not null), true)$w$;
  if position(was in f) = 0 then raise exception 'digest_post_people changed'; end if;
  execute replace(f, was, $n$  where e.is_active
    -- A draft sent as a test (0260): its testers. Sent to chosen people (0235): out of them, test accounts too
    -- when named (0260). Else every employee.
    and coalesce((select e.id = any (a.testers) from digest_posts a where a.id = p_id and a.published_at is null and cardinality(a.testers) > 0),
                 (select e.id = any (a.audience_ids) from digest_posts a where a.id = p_id and a.audience_ids is not null),
                 e.account_type = 'employee')$n$);
end $$;

-- Publishing a draft: the test's traces go.
create or replace function public.digest_clear_test(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from digest_form_responses where post_id = p_id;
  delete from digest_form_anon where post_id = p_id;
  delete from digest_quiz_starts where post_id = p_id;
  delete from digest_votes where post_id = p_id;
  delete from digest_views where post_id = p_id;
  delete from digest_likes where post_id = p_id;
  delete from digest_comments where post_id = p_id;
  delete from digest_joins where post_id = p_id;
  delete from digest_video_views where post_id = p_id;
end $$;
revoke all on function public.digest_clear_test(uuid) from public, anon, authenticated;

create or replace function public.digest_set_published(p_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
declare first_time boolean;
begin
  select p_published and published_at is null into first_time
  from digest_posts where id = p_id and deleted_at is null and digest_can_edit(id);
  if not found then raise exception 'Only whoever posted it can publish it'; end if;
  -- The first publishing (0260): what the test left is cleared before anybody else sees it.
  if first_time then perform digest_clear_test(p_id); end if;
  update digest_posts
  set published_at = case when p_published then coalesce(published_at, now()) end,
      testers = case when p_published then '{}' else testers end
  where id = p_id;
end $$;

-- Tincy's "Test" quiz of 6 Nov, published before this: her and Kevin's test answers, made before it went out.
delete from digest_form_responses r using digest_posts p
where p.id = '69cbe088-7278-4301-86eb-aa50b26f5e5e' and r.post_id = p.id and r.created_at < p.published_at;
delete from digest_quiz_starts s using digest_posts p
where p.id = '69cbe088-7278-4301-86eb-aa50b26f5e5e' and s.post_id = p.id and s.started_at < p.published_at;
