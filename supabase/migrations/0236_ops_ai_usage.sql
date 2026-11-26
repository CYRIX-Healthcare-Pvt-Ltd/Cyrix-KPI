/*
  0236 — Ops: what the AI costs in Pulse and BEMMP, next to Cyra's (the user, 31 Oct: "do 3").

  Cyra Assist meters every model call in its own database (cyra_v2.llm_usage). Pulse's AI chat (Gemini) and
  BEMMP's assistant (OpenAI) metered nothing, so the Ops page's AI panel showed one app's bill as if it were
  the whole of it. Each now reports a call's tokens here, from its server, as the signed-in person who asked:

    ops_ai_usage          one row per app, India day, model and feature: calls, input / cached / output tokens,
                          and up to 50 of the people who asked. Grouped as it arrives, like ops_error (0230).
    ops_ai_price          price per million tokens by model prefix, longest prefix wins (the same rule as Cyra's
                          llm_price). OpenAI rows copied from Cyra's table, read 29-30 Oct. Gemini has no row yet:
                          its calls are counted and show "no price" until one is added (see the end of this file).
    ops_report_ai(...)    signed-in callers only, never raises; tokens capped per call so a bad client cannot
                          write a fortune into the bill.
    ops_ai(p_days)        for the page: cost per day per app, and totals per app / model / feature. Ops admins only.

  Kept 400 days: a year's bill is worth comparing against. Undo: supabase/undo/0236_ops_ai_usage.undo.sql.
*/

create table if not exists ops_ai_price (
  model_prefix   text primary key,
  input_per_m    numeric not null,
  cached_per_m   numeric,
  output_per_m   numeric not null,
  source         text
);
alter table ops_ai_price enable row level security;

insert into ops_ai_price (model_prefix, input_per_m, cached_per_m, output_per_m, source) values
  ('gpt-4.1',     2.00, 0.50,  8.00,  'OpenAI list price, as in cyra_v2.llm_price (2026-10-30)'),
  ('gpt-4o',      2.50, 1.25,  10.00, 'OpenAI list price, as in cyra_v2.llm_price (2026-09-29)'),
  ('gpt-4o-mini', 0.15, 0.075, 0.60,  'OpenAI list price, as in cyra_v2.llm_price (2026-09-29)')
on conflict (model_prefix) do nothing;

create table if not exists ops_ai_usage (
  app            text not null,
  day            date not null,
  model          text not null,
  feature        text not null,
  calls          int    not null default 0,
  input_tokens   bigint not null default 0,
  cached_tokens  bigint not null default 0,
  output_tokens  bigint not null default 0,
  employees      uuid[] not null default '{}',
  primary key (app, day, model, feature)
);
alter table ops_ai_usage enable row level security;

create or replace function ops_report_ai(p_app text, p_feature text, p_model text,
                                         p_input int default 0, p_cached int default 0, p_output int default 0)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := current_employee_id();
  d  date := (now() at time zone 'Asia/Kolkata')::date;
  m  text := left(lower(btrim(coalesce(p_model, ''))), 60);
  f  text := left(lower(btrim(coalesce(p_feature, ''))), 40);
begin
  if auth.uid() is null then return; end if;
  if p_app is null or p_app not in ('pulse', 'bemmp', 'portal', 'kpi', 'spare', 'revive', 'travel', 'tasks') then return; end if;
  if m = '' then return; end if;
  insert into ops_ai_usage as u (app, day, model, feature, calls, input_tokens, cached_tokens, output_tokens, employees)
  values (p_app, d, m, coalesce(nullif(f, ''), 'other'), 1,
          least(greatest(coalesce(p_input, 0), 0), 2000000),
          least(greatest(coalesce(p_cached, 0), 0), 2000000),
          least(greatest(coalesce(p_output, 0), 0), 200000),
          case when me is null then '{}' else array[me] end)
  on conflict (app, day, model, feature) do update
    set calls         = u.calls + 1,
        input_tokens  = u.input_tokens + excluded.input_tokens,
        cached_tokens = u.cached_tokens + excluded.cached_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        employees     = case when me is null or me = any (u.employees) or cardinality(u.employees) >= 50
                             then u.employees else u.employees || me end;
exception when others then
  return;
end $$;

revoke all on function ops_report_ai(text, text, text, int, int, int) from public, anon;
grant execute on function ops_report_ai(text, text, text, int, int, int) to authenticated;

/** Estimated cost of one row: cached input at the cached price where there is one, the rest at the input price. */
create or replace function ops_ai_cost(p_model text, p_input bigint, p_cached bigint, p_output bigint)
returns numeric
language sql stable
set search_path = public
as $$
  select ((greatest(p_input - p_cached, 0) * p.input_per_m
           + p_cached * coalesce(p.cached_per_m, p.input_per_m)
           + p_output * p.output_per_m) / 1e6)::numeric(12, 4)
  from ops_ai_price p
  where p_model like p.model_prefix || '%'
  order by length(p.model_prefix) desc
  limit 1
$$;

revoke all on function ops_ai_cost(text, bigint, bigint, bigint) from public, anon, authenticated;

create or replace function ops_ai(p_days int default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare since date;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  since := (now() at time zone 'Asia/Kolkata')::date - greatest(1, least(coalesce(p_days, 30), 400)) + 1;
  return (
    with r as (
      select app, day, model, feature, calls, input_tokens + output_tokens tokens, employees,
             ops_ai_cost(model, input_tokens, cached_tokens, output_tokens) cost
      from ops_ai_usage where day >= since
    )
    select jsonb_build_object(
      'cost',     coalesce((select sum(cost) from r), 0),
      'calls',    coalesce((select sum(calls) from r), 0),
      'unpriced', coalesce((select jsonb_agg(distinct model) from r where cost is null), '[]'::jsonb),
      'by_day',   coalesce((select jsonb_agg(jsonb_build_object('day', day, 'app', app, 'cost', c, 'calls', n) order by day)
                            from (select day, app, coalesce(sum(cost), 0) c, sum(calls) n from r group by day, app) x), '[]'::jsonb),
      'by_app',   coalesce((select jsonb_agg(jsonb_build_object('key', app, 'cost', c, 'calls', n, 'tokens', t,
                                                                 'people', (select count(distinct e) from r r2, unnest(r2.employees) e where r2.app = x.app)) order by c desc)
                            from (select app, coalesce(sum(cost), 0) c, sum(calls) n, sum(tokens) t from r group by app) x), '[]'::jsonb),
      'by_model', coalesce((select jsonb_agg(jsonb_build_object('key', app || ' · ' || model, 'cost', c, 'calls', n, 'tokens', t, 'priced', p) order by c desc)
                            from (select app, model, coalesce(sum(cost), 0) c, sum(calls) n, sum(tokens) t, bool_and(cost is not null) p
                                  from r group by app, model) x), '[]'::jsonb),
      'by_feature', coalesce((select jsonb_agg(jsonb_build_object('key', app || ' · ' || feature, 'cost', c, 'calls', n, 'tokens', t) order by c desc)
                              from (select app, feature, coalesce(sum(cost), 0) c, sum(calls) n, sum(tokens) t from r group by app, feature) x), '[]'::jsonb)
    )
  );
end $$;

revoke all on function ops_ai(int) from public, anon;
grant execute on function ops_ai(int) to authenticated, service_role;

select cron.unschedule('ops-ai-prune') where exists (select 1 from cron.job where jobname = 'ops-ai-prune');
select cron.schedule('ops-ai-prune', '23 3 * * *', $$delete from public.ops_ai_usage where day < current_date - 400$$);

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
begin
  perform ops_report_ai('pulse', 'chat', 'gemini-test', 10, 0, 10);
  if exists (select 1 from ops_ai_usage where model = 'gemini-test') then
    raise exception '0236: an anonymous caller wrote usage';
  end if;
  if ops_ai_cost('gpt-4o-mini-2024-07-18', 1000000, 0, 1000000) <> 0.75 then
    raise exception '0236: gpt-4o-mini priced at %, expected 0.75', ops_ai_cost('gpt-4o-mini-2024-07-18', 1000000, 0, 1000000);
  end if;
  if ops_ai_cost('gpt-4o-2024-08-06', 1000000, 1000000, 0) <> 1.25 then
    raise exception '0236: cached gpt-4o input not at the cached price';
  end if;
  if ops_ai_cost('gemini-x', 1, 0, 1) is not null then raise exception '0236: an unknown model got a price'; end if;
  begin
    perform ops_ai(7);
    raise exception '0236: ops_ai() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon', 'ops_report_ai(text, text, text, int, int, int)', 'execute') then
    raise exception '0236: anon can call ops_report_ai()';
  end if;
  raise notice '0236: AI usage metering ready';
end $$;

/*
  To price Gemini (Pulse's AI chat), add its row with the current list price per million tokens, e.g.:
    insert into ops_ai_price (model_prefix, input_per_m, cached_per_m, output_per_m, source)
    values ('gemini-3.6-flash', <input>, <cached>, <output>, 'ai.google.dev/pricing read <date>');
*/
