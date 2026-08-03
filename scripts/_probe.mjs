import pg from 'pg'
import dotenv from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()

console.log('E1427 assignment:')
console.table((await c.query(
  `select a.status, a.job_role_weight, a.esms_weight, a.core_values_weight, a.approved_at
   from kpi_assignments a join employees e on e.id = a.employee_id
   where e.ecode = 'E1427'`)).rows)

console.log('\nE1427 rows:')
console.table((await c.query(
  `select i.section, i.kra, i.weightage
   from kpi_assignment_items i
   join kpi_assignments a on a.id = i.assignment_id
   join employees e on e.id = a.employee_id
   where e.ecode = 'E1427' order by i.sort_order`)).rows)

console.log('\neveryone carrying ESMS now:')
console.table((await c.query(
  `select e.ecode, e.full_name, a.status, a.esms_weight, a.core_values_weight
   from kpi_assignments a join employees e on e.id = a.employee_id
   where a.esms_weight > 0`)).rows)

await c.end()
