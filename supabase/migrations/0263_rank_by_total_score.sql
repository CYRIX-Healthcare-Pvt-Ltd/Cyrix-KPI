-- Cyrix KPI  ·  0263  ·  Team and Cyrix-wide rank by total score
--
-- The user, 6 Nov: "yes, just take total %" — after seeing that the band method (0.8 x Job Role band + 0.2 x Core
-- Values band) and the total score ranked 264 of 1,086 people differently. The profile's Team rank and the
-- Cyrix-wide rank now follow the total score, highest first, the same as the Dashboard's team card (0262). The
-- bands are still worked out and shown, and the managers' ranking (which uses the team's band) is unchanged.
do $$
declare f text; was_t text; was_o text;
begin
  f := replace(pg_get_functiondef('public.kpi_ranking(uuid,text)'::regprocedure), E'\r\n', E'\n');
  if position('0263' in f) > 0 then return; end if;
  was_t := $w$      rank() over (partition by c.mgr
                   order by c.rank_v desc nulls last, c.job_b desc nulls last,
                            c.avg_score desc)                as t_rank,$w$;
  was_o := $w$      rank() over (order by c.rank_v desc nulls last, c.job_b desc nulls last,
                            c.avg_score desc)                as o_rank,$w$;
  if position(was_t in f) = 0 or position(was_o in f) = 0 then raise exception 'kpi_ranking changed'; end if;
  f := replace(f, was_t, $n$      -- The total score, highest first (0263).
      rank() over (partition by c.mgr order by c.avg_score desc) as t_rank,$n$);
  f := replace(f, was_o, $n$      rank() over (order by c.avg_score desc)                as o_rank,$n$);
  execute f;
end $$;
