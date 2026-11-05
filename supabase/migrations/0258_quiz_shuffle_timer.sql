-- =====================================================================
-- Cyrix KPI  ·  0258  ·  Quiz: shuffle and a timer
--
-- The user, 5 Nov: "shuffle questions (ie for some user question 1 will be
-- question 2 of others, same for answer choose option also) and quiz timer
-- ie when open form, should have start then on start time should tick".
--
-- shuffle: each person sees the questions, and each question's choices, in
-- an order of their own (worked out in the page from the post and the
-- person, so it stays the same when they come back).
-- time_limit_seconds: pressing Start records when (digest_quiz_start), and
-- the clock is the server's. Answers arriving within the time (and 30
-- seconds' grace for a slow phone) are scored as sent, unanswered questions
-- counting as wrong; answers arriving later are not counted. A start cannot
-- be made again to win more time, except for a new attempt when Allow
-- submitting again is on.
-- =====================================================================

alter table digest_posts add column if not exists shuffle boolean not null default false;
alter table digest_posts add column if not exists time_limit_seconds int;
alter table digest_posts drop constraint if exists digest_posts_time_limit_check;
alter table digest_posts add constraint digest_posts_time_limit_check check (time_limit_seconds is null or time_limit_seconds between 5 and 36000);

create table if not exists digest_quiz_starts (
  post_id uuid not null references digest_posts (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (post_id, employee_id)
);
alter table digest_quiz_starts enable row level security;
revoke all on digest_quiz_starts from anon, authenticated;

create or replace function digest_set_quiz_options(p_id uuid, p_shuffle boolean, p_seconds int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the quiz can change this';
  end if;
  if p_seconds is not null and (p_seconds < 5 or p_seconds > 36000) then raise exception 'The timer goes from 5 seconds to 600 minutes'; end if;
  if (select time_limit_seconds from digest_posts where id = p_id) is distinct from p_seconds
     and exists (select 1 from digest_quiz_starts where post_id = p_id) then
    raise exception 'People have started it already, so the timer stays as it is';
  end if;
  update digest_posts set shuffle = coalesce(p_shuffle, false), time_limit_seconds = p_seconds where id = p_id;
end $$;
revoke all on function digest_set_quiz_options(uuid, boolean, int) from public, anon;
grant execute on function digest_set_quiz_options(uuid, boolean, int) to authenticated;

-- A start this person has not yet used for a submission, if any.
create or replace function digest_quiz_open_start(p_id uuid, p_me uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select s.started_at from digest_quiz_starts s
  where s.post_id = p_id and s.employee_id = p_me
    and not exists (select 1 from digest_form_responses r where r.post_id = p_id and r.employee_id = p_me and r.updated_at >= s.started_at)
$$;
revoke all on function digest_quiz_open_start(uuid, uuid) from public, anon, authenticated;

-- For the quiz's page: shuffle, the timer, and the seconds left on a start in progress (by the server's clock).
create or replace function digest_quiz_settings(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shuffle', p.shuffle, 'seconds', p.time_limit_seconds,
    'left', case when p.time_limit_seconds is not null then
      (select greatest(0, p.time_limit_seconds - floor(extract(epoch from now() - st))::int)
       from (select digest_quiz_open_start(p_id, current_employee_id()) st) x where st is not null) end)
  from digest_posts p where p.id = p_id and p.kind = 'quiz' and p.deleted_at is null and current_employee_id() is not null
$$;
revoke all on function digest_quiz_settings(uuid) from public, anon;
grant execute on function digest_quiz_settings(uuid) to authenticated;

-- Start the clock; the seconds left. A start in progress is kept, so pressing Start again wins no time.
create or replace function digest_quiz_start(p_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); p record; st timestamptz;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then raise exception 'That quiz is not there'; end if;
  if p.time_limit_seconds is null then return null; end if;
  st := digest_quiz_open_start(p_id, me);
  if st is null then
    if p.closes_at < now() then raise exception 'This quiz has closed'; end if;
    if not p.allow_again and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
      raise exception 'You have sent this quiz already';
    end if;
    insert into digest_quiz_starts (post_id, employee_id, started_at) values (p_id, me, now())
    on conflict (post_id, employee_id) do update set started_at = now();
    st := now();
  end if;
  return greatest(0, p.time_limit_seconds - floor(extract(epoch from now() - st))::int);
end $$;
revoke all on function digest_quiz_start(uuid) from public, anon;
grant execute on function digest_quiz_start(uuid) to authenticated;

-- Sending, with the timer: within the time (and grace) as sent, unanswered counting as wrong; later, nothing counts.
create or replace function digest_quiz_submit(p_id uuid, p_answers jsonb)
returns table (score int, max_score int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id(); p record; st timestamptz; timed boolean; ans jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; picked text[]; clean jsonb := '{}'::jsonb; got int := 0; total int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then raise exception 'That quiz is not there'; end if;
  timed := p.time_limit_seconds is not null;
  if not p.allow_again and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception 'You have sent this quiz already';
  end if;
  if timed then
    st := digest_quiz_open_start(p_id, me);
    if st is null then raise exception 'Press Start first'; end if;
    if now() > st + make_interval(secs => p.time_limit_seconds + 30) then ans := '{}'::jsonb; end if;
  elsif p.closes_at < now() then
    raise exception 'This quiz has closed';
  end if;

  for q in select * from digest_form_questions where post_id = p_id order by position loop
    total := total + q.points;
    v := ans -> q.id::text;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if timed then continue; end if;
      raise exception 'Answer "%" first', q.label;
    end if;
    if q.qtype = 'many' then
      if jsonb_typeof(v) <> 'array' then raise exception 'Choose from the choices for "%"', q.label; end if;
      select coalesce(array_agg(distinct x), '{}') into picked from jsonb_array_elements_text(v) x;
      if exists (select 1 from unnest(picked) x where not (x = any (q.options))) then raise exception 'Choose from the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, to_jsonb(picked));
      if picked <@ q.correct and q.correct <@ picked then got := got + q.points; end if;
    elsif q.qtype = 'short' then
      if jsonb_typeof(v) <> 'string' then raise exception 'Answer "%" in words', q.label; end if;
      if length(v #>> '{}') > 300 then raise exception 'The answer to "%" is too long', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, btrim(v #>> '{}'));
      if lower(regexp_replace(btrim(v #>> '{}'), '\s+', ' ', 'g')) = any (select lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) from unnest(q.correct) x) then
        got := got + q.points;
      end if;
    else
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (q.options)) then raise exception 'Choose one of the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, v);
      if (v #>> '{}') = any (q.correct) then got := got + q.points; end if;
    end if;
  end loop;
  insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, score = excluded.score, max_score = excluded.max_score, updated_at = now();
  return query select got, total;
end $$;
revoke all on function digest_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function digest_quiz_submit(uuid, jsonb) to authenticated;
