import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: new URL('../.env.local', import.meta.url) })
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await db.connect()
const q = async (l, s, p = []) => {
  const { rows } = await db.query(s, p); console.log('\n== ' + l); console.table(rows)
}

await q('dimensions are populated', `
  select count(*) filter (where function_name is not null)::int as with_function,
         count(*) filter (where department is not null)::int as with_department,
         count(*) filter (where grade is not null)::int as with_grade,
         count(*)::int as total
  from employees where is_active`)

await q('report grouped by function only', `
  select function_name, team, scored, to_score, not_submitted, scored_pct,
         avg_score, tm_tat, rm_tat
  from kpi_report('2026-27', null, null, null, null, array['function'])
  order by team desc limit 6`)

await q('report for Jul-26, grouped by department', `
  select department, team, scored, not_submitted, scored_pct, avg_score
  from kpi_report('2026-27', date '2026-07-01', null, null, null,
                  array['department'])
  order by team desc limit 6`)

await q('full breakdown where something has been scored', `
  select function_name, department, manager_name, team, scored,
         scored_pct, avg_score, tm_tat, rm_tat
  from kpi_report('2026-27', null, null, null, null,
                  array['function','department','manager'])
  where scored > 0`)

await q('cascade: departments inside one function', `
  select distinct department from v_kpi_report_rows
  where function_name = 'KLBEMP' order by department limit 8`)

await db.end()
