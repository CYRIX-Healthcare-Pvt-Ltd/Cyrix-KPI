#!/usr/bin/env node
/**
 * Loads official email addresses onto employee records.
 *
 *   node scripts/import-emails.mjs <file.xlsx>            show what would change
 *   node scripts/import-emails.mjs <file.xlsx> --apply    write it
 *
 * Deliberately not the bulk employee import on the admin screen. That
 * one upserts the whole person — name, designation, department, location
 * — and stamps is_active and must_change_password on every row it
 * touches. Feeding it a sheet of two columns would blank the fields it
 * cannot see, reactivate anybody who has left, and force a password
 * change on the entire company. It would also import nothing at all,
 * because it drops any row with no name in it.
 *
 * This writes one column and reads two. Nothing else on the record is
 * touched, and an employee code that does not exist is reported rather
 * than created.
 *
 * Needs SUPABASE_DB_URL in .env.local.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const file = process.argv[2]
const apply = process.argv.includes('--apply')

if (!file) {
  console.error('Usage: node scripts/import-emails.mjs <file.xlsx> [--apply]')
  process.exit(1)
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL is not set. See .env.example.')
  process.exit(1)
}

/** Header matching that survives Employee_Code, "employee code" and ECODE. */
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const pick = (row, ...names) => {
  const map = Object.fromEntries(Object.keys(row).map(k => [norm(k), k]))
  for (const n of names) {
    const hit = map[norm(n)]
    if (hit && row[hit] != null && String(row[hit]).trim() !== '') {
      return String(row[hit]).trim()
    }
  }
  return ''
}

const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const raw = XLSX.utils.sheet_to_json(sheet, { defval: null })

const parsed = raw
  .map(r => ({
    ecode: pick(r, 'employee_code', 'ecode', 'employee code', 'code').toUpperCase(),
    email: pick(r, 'official_email', 'email', 'work email', 'work_email', 'mail')
      .toLowerCase(),
  }))
  .filter(r => r.ecode)

// Not a validator, a filter: anything without a local part, an @ and a dot
// after it cannot receive a code, and a blank cell is the common case.
const looksLikeEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)

const usable = parsed.filter(r => looksLikeEmail(r.email))
const unusable = parsed.filter(r => !looksLikeEmail(r.email))

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows: live } = await client.query(
  `select id, upper(ecode) as ecode, full_name, work_email, is_active from employees`,
)
const byEcode = new Map(live.map(e => [e.ecode, e]))

const changes = []
const unchanged = []
const missing = []

for (const r of usable) {
  const emp = byEcode.get(r.ecode)
  if (!emp) { missing.push(r); continue }
  if ((emp.work_email ?? '').toLowerCase().trim() === r.email) { unchanged.push(r); continue }
  changes.push({ ...r, id: emp.id, was: emp.work_email, active: emp.is_active })
}

const activeChanges = changes.filter(c => c.active)
const inactiveChanges = changes.filter(c => !c.active)

// Two people, one inbox: either of them can ask for the other's reset
// code and read it. Not a reason to refuse the load — shared addresses
// are a real thing on a service floor — but it is a reason to say so.
const shared = new Map()
for (const c of activeChanges) shared.set(c.email, [...(shared.get(c.email) ?? []), c.ecode])
const duplicated = [...shared.entries()].filter(([, who]) => who.length > 1)

const activeLive = live.filter(e => e.is_active)
const willHave = new Set([
  ...activeLive.filter(e => e.work_email).map(e => e.ecode),
  ...activeChanges.map(c => c.ecode),
])
const stillWithout = activeLive.filter(e => !willHave.has(e.ecode))

console.log(`
  sheet rows with an employee code : ${parsed.length}
  ...carrying a usable address     : ${usable.length}   (${unusable.length} blank or malformed)

  already correct                  : ${unchanged.length}
  TO WRITE, active employees       : ${activeChanges.length}
  TO WRITE, inactive employees     : ${inactiveChanges.length}
  employee code not in the system  : ${missing.length}

  active employees, after this run
    with an address                : ${willHave.size} of ${activeLive.length}
    still without one              : ${stillWithout.length}
`)

if (duplicated.length) {
  console.log(`  ${duplicated.length} address(es) shared by more than one active employee.`)
  console.log('  Either person can request the other\'s reset code and read it:')
  for (const [email, who] of duplicated.slice(0, 10)) {
    console.log(`    ${email}  <-  ${who.join(', ')}`)
  }
  console.log()
}

if (stillWithout.length) {
  console.log(`  Still without an address (HR reset is their only route back in):`)
  console.log('   ', stillWithout.slice(0, 15).map(e => e.ecode).join(', ') +
    (stillWithout.length > 15 ? `, +${stillWithout.length - 15} more` : ''))
  console.log()
}

if (!apply) {
  console.log('  Nothing written. Re-run with --apply to write it.\n')
  await client.end()
  process.exit(0)
}

// One statement, one transaction. A half-loaded roster is worse than an
// unloaded one, because you cannot tell by looking which half it is.
await client.query('begin')
try {
  const res = await client.query(
    `update employees e set work_email = v.email
     from (select unnest($1::uuid[]) as id, unnest($2::text[]) as email) v
     where e.id = v.id`,
    [changes.map(c => c.id), changes.map(c => c.email)],
  )
  await client.query('commit')
  console.log(`  Written: ${res.rowCount} record(s) now carry an official email.\n`)
} catch (err) {
  await client.query('rollback')
  console.error('  Nothing written -', err.message)
  process.exitCode = 1
}

await client.end()
