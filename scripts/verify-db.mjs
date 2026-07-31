#!/usr/bin/env node
/**
 * Post-migration sanity check. Confirms the schema, the seed data and the
 * scoring engine are actually live, and that RLS is switched on for every
 * table holding appraisal data.
 *
 *   node scripts/verify-db.mjs
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

await client.connect()

// ---- tables ----------------------------------------------------------
console.log('\nTables')
const expected = [
  'employees', 'job_roles', 'user_roles', 'financial_years', 'audit_log',
  'scoring_rules', 'kpi_templates', 'kpi_template_items',
  'kpi_assignments', 'kpi_assignment_items',
  'kpi_submissions', 'kpi_submission_items',
  'core_value_definitions', 'core_value_ratings', 'rating_scale', 'app_settings',
]
const { rows: tables } = await client.query(
  `select tablename from pg_tables where schemaname = 'public'`,
)
const present = new Set(tables.map(t => t.tablename))
const missing = expected.filter(t => !present.has(t))
check(`${expected.length} expected tables`, missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `(${present.size} total)`)

// ---- RLS -------------------------------------------------------------
console.log('\nRow-Level Security')
const { rows: rls } = await client.query(`
  select c.relname, c.relrowsecurity,
         (select count(*) from pg_policies p
          where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname = any($1)
  order by c.relname
`, [expected])

const rlsOff = rls.filter(r => !r.relrowsecurity).map(r => r.relname)
check('RLS enabled on every table', rlsOff.length === 0,
      rlsOff.length ? `OFF for: ${rlsOff.join(', ')}` : '')

const noPolicy = rls.filter(r => r.relrowsecurity && Number(r.policies) === 0)
check('every RLS table has policies', noPolicy.length === 0,
      noPolicy.length ? `none on: ${noPolicy.map(r => r.relname).join(', ')}` : '')

const totalPolicies = rls.reduce((a, r) => a + Number(r.policies), 0)
console.log(`    ${totalPolicies} policies across ${rls.length} tables`)

// ---- guard triggers --------------------------------------------------
console.log('\nColumn guards')
const { rows: trg } = await client.query(`
  select tgname from pg_trigger
  where not tgisinternal and tgname like 'trg_guard%'
`)
check('guard triggers installed', trg.length >= 3,
      trg.map(t => t.tgname).join(', '))

// ---- seed ------------------------------------------------------------
console.log('\nSeed data')
for (const [label, sql, want] of [
  ['financial years', 'select count(*) from financial_years', 3],
  ['scoring rules', 'select count(*) from scoring_rules', 7],
  ['rating scale', 'select count(*) from rating_scale', 5],
  ['core values', 'select count(*) from core_value_definitions', 5],
  ['template rows', 'select count(*) from kpi_template_items', 5],
]) {
  const { rows } = await client.query(sql)
  const n = Number(rows[0].count)
  check(label, n === want, `${n} of ${want}`)
}

const { rows: fy } = await client.query(
  `select code from financial_years where is_current`)
check('current financial year set', fy.length === 1, fy[0]?.code ?? 'none')

// ---- the 80/20 split -------------------------------------------------
const { rows: split } = await client.query(`
  select section, sum(weightage)::numeric as total
  from kpi_template_items group by section order by section
`)
const job = split.find(s => s.section === 'job_role')?.total
const core = split.find(s => s.section === 'core_values')?.total
check('seeded template splits 80 / 20', Number(job) === 80 && Number(core) === 20,
      `job_role ${job}, core_values ${core}`)

// ---- scoring engine, live against the real function ------------------
console.log('\nScoring engine (live, against KPI 26-27 Template.xlsx)')
const cases = [
  ['Response time on target',        'higher_capped', 25, 100, 100, '{}', 25],
  ['Response time at half',          'higher_capped', 25, 100,  50, '{}', 12.5],
  ['Response time overachieved',     'higher_capped', 25, 100, 150, '{}', 25],
  ['Documentation 40 vs target 35',  'lower_penalty', 20,  35,  40, '{}', 17.5],
  ['Service quality 0 vs target 0',  'lower_penalty', 10,   0,   0, '{}', 10],
  ['Service quality 2 vs target 0',  'lower_penalty', 10,   0,   2, '{}', 0],
  ['Uncapped can exceed weightage',  'higher_uncapped', 25, 100, 150, '{}', 37.5],
  ['Negative score allowed',         'lower_linear',  10,   5,  15, '{"allow_negative":true}', -10],
  ['Core values all Excellent',      'rating_scale',  20, 100, 100, '{}', 20],
]
for (const [label, rule, wt, tgt, ach, params, want] of cases) {
  const { rows } = await client.query(
    'select calc_kpi_score($1,$2,$3,$4,$5::jsonb) as score',
    [rule, wt, tgt, ach, params],
  )
  const got = Number(rows[0].score)
  check(label, got === want, `${got} (expected ${want})`)
}

// ---- workflow functions ----------------------------------------------
console.log('\nWorkflow functions')
const { rows: fns } = await client.query(`
  select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname = any($1) order by proname
`, [[
  'calc_kpi_score', 'recompute_submission_totals', 'open_submission',
  'submit_self_assessment', 'submit_manager_scores', 'finalize_submission',
  'return_submission', 'reopen_submission', 'submit_assignment_for_approval',
  'approve_assignment', 'reject_assignment', 'validate_assignment',
  'current_employee_id', 'is_hr_admin', 'manages_employee',
]])
check('all 15 functions present', fns.length === 15, `${fns.length} found`)

// ---- views -----------------------------------------------------------
const { rows: views } = await client.query(
  `select viewname from pg_views where schemaname='public' order by viewname`)
check('reporting views present', views.length >= 3,
      views.map(v => v.viewname).join(', '))

await client.end()

console.log(
  failures === 0
    ? '\nAll checks passed. Database is ready.\n'
    : `\n${failures} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
