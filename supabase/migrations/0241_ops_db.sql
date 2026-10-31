-- =====================================================================
-- Cyrix KPI  ·  0241  ·  ops_db(): the shared database's own health
--
-- For the Ops page's Infrastructure panel (Adrian, 31 Oct 2026: "showcase
-- the DB server location, latency"). It returns what only the database
-- can see; no access token is needed, because it reads Postgres's own
-- statistics:
--
--   version, started (last restart), size, connections by state against
--   max_connections, cache hit %, the 5 statements costing the most total
--   time (pg_stat_statements, already normalised to $1 placeholders, cut
--   to 100 chars), and the 5 largest tables.
--
-- The region and the latency are not in here. The page measures latency
-- from the viewer's own browser, which is what users feel, and /api/ops
-- names the region.
-- =====================================================================

create or replace function ops_db()
returns jsonb
language plpgsql security definer stable
set search_path = public, extensions
as $$
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'version', current_setting('server_version'),
    'started', pg_postmaster_start_time(),
    'size_bytes', pg_database_size(current_database()),
    'max_connections', current_setting('max_connections')::int,
    'connections', coalesce((select jsonb_object_agg(coalesce(state, 'other'), n)
                             from (select state, count(*) n from pg_stat_activity
                                   where datname = current_database() group by state) s), '{}'::jsonb),
    'cache_hit_pct', (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2)
                      from pg_stat_database where datname = current_database()),
    'slow', coalesce((select jsonb_agg(q) from (
               select left(regexp_replace(query, '\s+', ' ', 'g'), 100) query, calls,
                      round(mean_exec_time::numeric, 1) mean_ms, round(total_exec_time::numeric / 1000, 1) total_s
               from extensions.pg_stat_statements
               where dbid = (select oid from pg_database where datname = current_database())
               order by total_exec_time desc limit 5) q), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(t) from (
                 select schemaname || '.' || relname as name, pg_total_relation_size(relid) bytes, n_live_tup as rows
                 from pg_stat_user_tables order by 2 desc limit 5) t), '[]'::jsonb)
  );
end $$;

revoke all on function ops_db() from public, anon;
grant execute on function ops_db() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'ops_db()', 'execute') then
    raise exception '0241: anon can call ops_db';
  end if;
end $$;
