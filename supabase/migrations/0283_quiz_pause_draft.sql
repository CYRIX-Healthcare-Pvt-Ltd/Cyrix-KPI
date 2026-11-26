-- =====================================================================
-- Cyrix KPI  ·  0283  ·  A timed quiz pauses when you leave, and keeps your answers
--
-- The user, 12 Nov, after Shivam Kumar Awadhiya took a call mid-quiz and came
-- back to "timer over, 1 of 15": "can we make it as draft? ie time freeze".
-- Leaving the quiz (closing it, going back, switching apps) stops the clock
-- and keeps the answers chosen so far; Continue starts the clock again with
-- the time that was left and the same answers. Answers are also kept as they
-- are chosen, so a phone that dies keeps them too.
--
-- digest_quiz_starts gains used_seconds (time spent so far), running_since
-- (when the clock last started; null while paused) and draft (answers so far).
-- The clock is still the server's. Time taken in the poster's Excel is the
-- time the clock ran, not the minutes away.
-- =====================================================================

alter table digest_quiz_starts add column if not exists used_seconds int not null default 0;
alter table digest_quiz_starts add column if not exists running_since timestamptz;
alter table digest_quiz_starts add column if not exists draft jsonb;
-- Starts made before this ran: their clock has been running since they began.
update digest_quiz_starts set running_since = started_at where running_since is null and used_seconds = 0;

-- Seconds the clock has run on a start, by the server.
create or replace function digest_quiz_used(s digest_quiz_starts)
returns int
language sql stable as $$
  select s.used_seconds + case when s.running_since is null then 0 else floor(extract(epoch from now() - s.running_since))::int end
$$;

-- The open start row (not yet sent) for this person, if any.
create or replace function digest_quiz_open_row(p_id uuid, p_me uuid)
returns digest_quiz_starts
language sql stable security definer set search_path = public as $$
  select s.* from digest_quiz_starts s
  where s.post_id = p_id and s.employee_id = p_me
    and not exists (select 1 from digest_form_responses r where r.post_id = p_id and r.employee_id = p_me and r.updated_at >= s.started_at)
$$;
revoke all on function digest_quiz_open_row(uuid, uuid) from public, anon, authenticated;

-- For the quiz's page: shuffle, the timer, the seconds left, whether it is paused, and the answers kept.
create or replace function digest_quiz_settings(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; s digest_quiz_starts; me uuid := current_employee_id();
begin
  if me is null then return null; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then return null; end if;
  if p.time_limit_seconds is not null then s := digest_quiz_open_row(p_id, me); end if;
  return jsonb_build_object('shuffle', p.shuffle, 'seconds', p.time_limit_seconds,
    'left', case when s.post_id is not null then greatest(0, p.time_limit_seconds - digest_quiz_used(s)) end,
    'paused', s.post_id is not null and s.running_since is null,
    'draft', case when s.post_id is not null then coalesce(s.draft, '{}'::jsonb) end);
end $$;
revoke all on function digest_quiz_settings(uuid) from public, anon;
grant execute on function digest_quiz_settings(uuid) to authenticated;

-- Start, or continue a paused start; the seconds left. Continuing wins no time.
create or replace function digest_quiz_start(p_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); p record; s digest_quiz_starts;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then raise exception 'That quiz is not there'; end if;
  if p.time_limit_seconds is null then return null; end if;
  s := digest_quiz_open_row(p_id, me);
  if s.post_id is null then
    if p.closes_at < now() then raise exception 'This quiz has closed'; end if;
    if not p.allow_again and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
      raise exception 'You have sent this quiz already';
    end if;
    insert into digest_quiz_starts (post_id, employee_id, started_at, used_seconds, running_since, draft) values (p_id, me, now(), 0, now(), null)
    on conflict (post_id, employee_id) do update set started_at = now(), used_seconds = 0, running_since = now(), draft = null;
    return p.time_limit_seconds;
  end if;
  if s.running_since is null then
    update digest_quiz_starts set running_since = now() where post_id = p_id and employee_id = me;
  end if;
  return greatest(0, p.time_limit_seconds - digest_quiz_used(s));
end $$;
revoke all on function digest_quiz_start(uuid) from public, anon;
grant execute on function digest_quiz_start(uuid) to authenticated;

-- Keep the answers so far; p_pause also stops the clock (leaving the quiz).
create or replace function digest_quiz_keep(p_id uuid, p_answers jsonb, p_pause boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); lim int; s digest_quiz_starts;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select time_limit_seconds into lim from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if lim is null then return null; end if;
  s := digest_quiz_open_row(p_id, me);
  if s.post_id is null then return null; end if;
  if pg_column_size(p_answers) > 65536 then raise exception 'Too much to keep'; end if;
  update digest_quiz_starts set draft = coalesce(p_answers, '{}'::jsonb),
    used_seconds = case when p_pause and running_since is not null then least(lim, digest_quiz_used(s)) else used_seconds end,
    running_since = case when p_pause then null else running_since end
  where post_id = p_id and employee_id = me;
  return greatest(0, lim - digest_quiz_used(s));
end $$;
revoke all on function digest_quiz_keep(uuid, jsonb, boolean) from public, anon;
grant execute on function digest_quiz_keep(uuid, jsonb, boolean) to authenticated;

-- Sending: within the time the clock has run (and 30 seconds' grace) as sent; past it, the answers kept are what count.
create or replace function digest_quiz_submit(p_id uuid, p_answers jsonb)
returns table (score int, max_score int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id(); p record; s digest_quiz_starts; timed boolean; ans jsonb := coalesce(p_answers, '{}'::jsonb);
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
    s := digest_quiz_open_row(p_id, me);
    if s.post_id is null then raise exception 'Press Start first'; end if;
    if digest_quiz_used(s) > p.time_limit_seconds + 30 then ans := coalesce(s.draft, '{}'::jsonb); end if;
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
  -- The clock stops at sending; time taken is what it ran.
  if timed then
    update digest_quiz_starts set used_seconds = least(p.time_limit_seconds, digest_quiz_used(s)), running_since = null
    where post_id = p_id and employee_id = me;
  end if;
  insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, score = excluded.score, max_score = excluded.max_score, updated_at = now();
  return query select got, total;
end $$;
revoke all on function digest_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function digest_quiz_submit(uuid, jsonb) to authenticated;

-- The poster's scores: started_at is the sending less the time the clock ran, so "time taken" leaves out the pauses.
drop function if exists public.digest_quiz_scores(uuid);
create function public.digest_quiz_scores(p_id uuid)
returns table (ecode text, score integer, max_score integer, started_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query select e.ecode, r.score, r.max_score,
    case when s.post_id is null then null
         when s.used_seconds > 0 then r.updated_at - make_interval(secs => s.used_seconds)
         else s.started_at end,
    r.updated_at
  from digest_form_responses r join employees e on e.id = r.employee_id
  left join digest_quiz_starts s on s.post_id = r.post_id and s.employee_id = r.employee_id
  where r.post_id = p_id;
end $$;
revoke all on function public.digest_quiz_scores(uuid) from public, anon;
grant execute on function public.digest_quiz_scores(uuid) to authenticated;
