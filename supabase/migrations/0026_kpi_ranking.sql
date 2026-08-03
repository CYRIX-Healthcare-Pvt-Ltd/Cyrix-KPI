-- =====================================================================
-- Cyrix KPI  ·  0026  ·  Where do I stand?
--
-- "Second in my team, forty-fifth in Cyrix" is the question a scored
-- number immediately raises and the app has never answered.
--
-- It has to be computed here rather than in the browser, and not for
-- convenience: a team member can read their own submissions and nobody
-- else's, so there is no client-side query that could rank them against
-- 1,100 people. This function sees every average in order to count the
-- ones above yours, and returns a position and a denominator. No other
-- person's score leaves it.
--
-- Ranked among people who HAVE a score, not among everyone. Sitting
-- 40th of 340 means something; sitting 40th of 1,146 because 800 have
-- not been assessed yet does not. The whole team size is returned
-- alongside so the screen can say both.
--
-- rank() and not dense_rank(): two people tied at the top are both 1st
-- and the next is 3rd, which is what a leaderboard means by a tie.
-- =====================================================================
create or replace function kpi_ranking(
  p_employee_id    uuid default null,
  p_financial_year text default null
)
returns table (
  employee_id     uuid,
  financial_year  text,
  score           numeric,
  team_rank       integer,
  team_of         integer,
  org_rank        integer,
  org_of          integer,
  team_size       integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
begin
  if target is null then
    return;
  end if;

  -- Your own, your reports', or HR's business. Checked rather than
  -- assumed: this function is security definer, so without it anyone
  -- could ask for anyone's standing.
  if not (target = current_employee_id()
          or manages_employee(target)
          or is_hr_admin()) then
    raise exception 'You can only see your own ranking';
  end if;

  return query
  with scored as (
    select
      s.employee_id                       as emp,
      e.reporting_manager_id              as mgr,
      round(avg(s.final_total_score), 4)  as avg_score
    from kpi_submissions s
    join employees e on e.id = s.employee_id and e.is_active
    where s.financial_year = fy
      and s.status in ('scored', 'finalized')
      and s.final_total_score is not null
    group by s.employee_id, e.reporting_manager_id
  ),
  ranked as (
    select
      sc.emp,
      sc.avg_score,
      -- Partitioned by manager, so "my team" means the people who report
      -- where I report — my peers, not my own reports.
      rank()  over (partition by sc.mgr order by sc.avg_score desc) as t_rank,
      count(*) over (partition by sc.mgr)                           as t_of,
      rank()  over (order by sc.avg_score desc)                     as o_rank,
      count(*) over ()                                              as o_of
    from scored sc
  )
  select
    target,
    fy,
    round(r.avg_score, 2),
    r.t_rank::int,
    r.t_of::int,
    r.o_rank::int,
    r.o_of::int,
    (select count(*)::int
     from employees p
     where p.is_active
       and p.reporting_manager_id =
           (select reporting_manager_id from employees where id = target))
  from (select 1) one
  left join ranked r on r.emp = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;

comment on function kpi_ranking(uuid, text) is
  'One person''s standing for a financial year: rank within their team '
  'and within Cyrix, among the people who have been scored. Returns a '
  'position and a denominator only — no other employee''s score.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text;
  r        record;
  best     uuid;
  n_scored int;
  tm_uid   uuid;
  other    uuid;
  failed   boolean := false;
begin
  select code into fy from financial_years where is_current;

  select count(distinct employee_id) into n_scored
  from kpi_submissions
  where financial_year = fy and status in ('scored','finalized')
    and final_total_score is not null;

  if n_scored = 0 then
    raise notice '0026 self-test skipped — nobody has been scored yet';
    return;
  end if;

  -- The highest average in the company must come back as org rank 1.
  select s.employee_id into best
  from kpi_submissions s
  join employees e on e.id = s.employee_id and e.is_active
  where s.financial_year = fy and s.status in ('scored','finalized')
    and s.final_total_score is not null
  group by s.employee_id
  order by avg(s.final_total_score) desc
  limit 1;

  select * into r from kpi_ranking(best, fy);

  if r.org_rank <> 1 then
    raise exception 'the top scorer came back at org rank %', r.org_rank;
  end if;
  if r.org_of <> n_scored then
    raise exception 'ranked against % people, but % have scores',
      r.org_of, n_scored;
  end if;
  if r.team_rank is null or r.team_rank < 1 or r.team_rank > r.team_of then
    raise exception 'team rank % is outside 1..%', r.team_rank, r.team_of;
  end if;
  if r.team_size < r.team_of then
    raise exception
      'the team has % scored people but only % members', r.team_of, r.team_size;
  end if;

  -- Somebody with no scored month has no rank, rather than last place.
  select e.id into other from employees e
  where e.is_active and e.reporting_manager_id is not null
    and not exists (
      select 1 from kpi_submissions s
      where s.employee_id = e.id and s.status in ('scored','finalized'))
  limit 1;
  if other is not null then
    select * into r from kpi_ranking(other, fy);
    if r.org_rank is not null then
      raise exception 'an unscored employee was ranked %', r.org_rank;
    end if;
    if r.employee_id <> other then
      raise exception 'asked about % and got a row for %', other, r.employee_id;
    end if;
  end if;

  -- And one person cannot ask about another.
  select e.auth_user_id into tm_uid from employees e
  where e.auth_user_id is not null and e.is_active
    and e.id <> best
    and e.id not in (select employee_id from user_roles)
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
  limit 1;

  if tm_uid is not null then
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', tm_uid::text, 'role','authenticated')::text, true);
    begin
      perform * from kpi_ranking(best, fy);
      failed := true;
    exception when others then
      null;  -- refused, which is the point
    end;
    reset role;
    if failed then
      raise exception 'a team member read somebody else''s ranking';
    end if;
  end if;

  raise notice
    '0026 self-test passed — top scorer is 1 of %, unscored people are '
    'unranked, and nobody can ask about anybody else', n_scored;
end $$;
