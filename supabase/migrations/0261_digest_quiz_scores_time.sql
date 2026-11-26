-- Cyrix KPI  ·  0261  ·  Quiz scores carry when each person started and sent, for the rank in the Excel
--
-- The user, 6 Nov: "if in quiz, in emp wise sheet give rank also, ie score % and less time taken". The poster's
-- scores list adds started_at (pressing Start on a timed quiz) and sent_at (the last sending), so the download can
-- rank by score %, then by time taken, then by who sent first.
drop function if exists public.digest_quiz_scores(uuid);
create function public.digest_quiz_scores(p_id uuid)
returns table (ecode text, score integer, max_score integer, started_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query select e.ecode, r.score, r.max_score, s.started_at, r.updated_at
  from digest_form_responses r join employees e on e.id = r.employee_id
  left join digest_quiz_starts s on s.post_id = r.post_id and s.employee_id = r.employee_id
  where r.post_id = p_id;
end $$;
revoke all on function public.digest_quiz_scores(uuid) from public, anon;
grant execute on function public.digest_quiz_scores(uuid) to authenticated;
