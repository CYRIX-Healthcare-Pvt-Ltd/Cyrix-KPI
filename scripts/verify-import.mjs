#!/usr/bin/env node
/**
 * Checks the imported org data is sound: every active person has a login,
 * the reporting tree has no orphans or cycles, and HR admins exist.
 *
 *   node scripts/verify-import.mjs
 *
 * Worth re-running after every import, since the staff list changes.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()

let failures = 0
const one = async sql => (await c.query(sql)).rows[0].v

const stat = async (label, sql) =>
  console.log(`  ${label.padEnd(44)} ${await one(sql)}`)

const must = async (label, sql, expected = 0) => {
  const v = Number(await one(sql))
  const ok = v === expected
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(42)} ${v}`)
}

console.log('\nEmployees')
await stat('total rows', 'select count(*) v from employees')
await stat('active', 'select count(*) v from employees where is_active')
await stat('with a login linked', 'select count(*) v from employees where auth_user_id is not null')
await stat('must set a password on first login', 'select count(*) v from employees where must_change_password')
await stat('with a reporting manager', 'select count(*) v from employees where reporting_manager_id is not null')
await stat('who ARE managers', `select count(distinct reporting_manager_id) v
                                from employees where reporting_manager_id is not null`)

console.log('\nIntegrity')
await must('nobody manages themselves', 'select count(*) v from employees where id = reporting_manager_id')
await must('no duplicate ecodes', `select coalesce(sum(c-1),0) v from
  (select count(*) c from employees group by upper(ecode) having count(*)>1) t`)
await must('no orphan manager references', `select count(*) v from employees e
  where e.reporting_manager_id is not null
    and not exists (select 1 from employees m where m.id = e.reporting_manager_id)`)
await must('every active person has a login', `select count(*) v from employees
  where is_active and auth_user_id is null`)
await must('no leaver has a login', `select count(*) v from employees
  where not is_active and auth_user_id is not null`)
await must('no orphan auth users', `select count(*) v from auth.users u
  where not exists (select 1 from employees e where e.auth_user_id = u.id)`)

// A cycle means two people can approve each other's KPI, and nobody in the
// loop has a real escalation path. Name them rather than just counting.
const { rows: mutual } = await c.query(`
  select a.ecode a_code, a.full_name a_name, b.ecode b_code, b.full_name b_name
  from employees a
  join employees b on b.id = a.reporting_manager_id
  where a.reporting_manager_id = b.id
    and b.reporting_manager_id = a.id
    and a.ecode < b.ecode`)

// Longer loops, excluding anyone already named in a mutual pair — otherwise
// a single A<->B cycle re-reports at every even depth as the walk goes round.
const { rows: longer } = await c.query(`
  with recursive walk(start_id, id, depth) as (
    select id, reporting_manager_id, 1 from employees where reporting_manager_id is not null
    union all
    select w.start_id, e.reporting_manager_id, w.depth + 1
    from walk w join employees e on e.id = w.id
    where e.reporting_manager_id is not null and w.depth < 25
  )
  select e.ecode, e.full_name, min(w.depth) depth
  from walk w join employees e on e.id = w.start_id
  where w.id = w.start_id
    and not exists (
      select 1 from employees a
      join employees b on b.id = a.reporting_manager_id
      where a.id = w.start_id and b.reporting_manager_id = a.id)
  group by e.ecode, e.full_name
  order by depth limit 10`)

const cycleCount = mutual.length + longer.length
if (cycleCount > 0) failures++
console.log(`  ${cycleCount === 0 ? '✓' : '✗'} ${'no cycles in the reporting tree'.padEnd(42)} ${cycleCount}`)
mutual.forEach(m => console.log(
  `      ${m.a_code} ${m.a_name}  <->  ${m.b_code} ${m.b_name}   (manage each other)`))
longer.forEach(l => console.log(
  `      ${l.ecode} ${l.full_name}   (in a loop of ${l.depth})`))

console.log('\nAuth')
await stat('auth.users total', 'select count(*) v from auth.users')

console.log('\nHR admins')
const { rows: hr } = await c.query(`select e.ecode, e.full_name, ur.role
  from user_roles ur join employees e on e.id = ur.employee_id order by e.ecode`)
if (hr.length === 0) { failures++; console.log('  ✗ none configured — nobody can administer the system') }
hr.forEach(r => console.log(`  ✓ ${r.ecode.padEnd(12)} ${String(r.full_name).padEnd(22)} ${r.role}`))

console.log('\nTop of the tree')
const { rows: top } = await c.query(`select e.ecode, e.full_name,
  (select count(*) from employees x where x.reporting_manager_id = e.id) reports
  from employees e where e.reporting_manager_id is null order by reports desc limit 10`)
top.forEach(r => console.log(`  ${r.ecode.padEnd(12)} ${String(r.full_name).padEnd(24)} ${r.reports} direct report(s)`))

console.log('\nLargest teams')
const { rows: teams } = await c.query(`select m.ecode, m.full_name, count(*) n
  from employees e join employees m on m.id = e.reporting_manager_id
  group by m.ecode, m.full_name order by n desc limit 8`)
teams.forEach(r => console.log(`  ${r.ecode.padEnd(12)} ${String(r.full_name).padEnd(30)} ${r.n}`))

await c.end()
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
