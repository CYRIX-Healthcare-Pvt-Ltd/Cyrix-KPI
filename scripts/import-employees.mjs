#!/usr/bin/env node
/**
 * Bulk-imports the team member list and creates their logins.
 *
 *   node scripts/import-employees.mjs <file.xlsx|file.csv> [--dry-run] [--sheet Name]
 *
 * Expected columns (header names are matched loosely, case-insensitive):
 *   Ecode | Name | Designation | Department | Location | Job Role
 *   | Reporting Manager Ecode | Email | Date of Joining | HR Admin
 *
 * For each row it will:
 *   1. create a Supabase Auth user  <ecode>@cyrix.local  with the ecode
 *      as the initial password, flagged to force a change on first login
 *   2. upsert the employees row and link it to that auth user
 *   3. resolve reporting managers in a second pass, so the sheet does not
 *      have to be ordered manager-first
 *
 * Re-running is safe: existing ecodes are updated, not duplicated, and
 * existing passwords are never reset.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY — this bypasses RLS entirely, so run it
 * locally and never ship the key to a browser.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
dotenv.config({ path: join(root, '.env.local') })
dotenv.config({ path: join(root, '.env') })

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DOMAIN = process.env.VITE_AUTH_EMAIL_DOMAIN || 'cyrix.local'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const sheetArg = args[args.indexOf('--sheet') + 1]

if (!file) {
  console.error('Usage: node scripts/import-employees.mjs <file.xlsx|csv> [--dry-run]')
  process.exit(1)
}
if (!URL || !KEY) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// ---- read the sheet ---------------------------------------------------
const wb = XLSX.readFile(file)
const sheetName = sheetArg && wb.SheetNames.includes(sheetArg) ? sheetArg : wb.SheetNames[0]
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null })

const norm = s => String(s ?? '').trim()
const key = s => norm(s).toLowerCase().replace(/[^a-z]/g, '')

/** Finds a column by any of several likely header spellings. */
function pick(row, ...candidates) {
  const map = Object.fromEntries(Object.keys(row).map(k => [key(k), k]))
  for (const c of candidates) {
    const hit = map[key(c)]
    if (hit && row[hit] !== null && norm(row[hit]) !== '') return norm(row[hit])
  }
  return null
}

const rows = raw
  .map(r => ({
    ecode: pick(r, 'ecode', 'employee code', 'emp code', 'code', 'empid', 'employee id'),
    full_name: pick(r, 'name', 'full name', 'employee name', 'tm name'),
    designation: pick(r, 'designation', 'role', 'title'),
    department: pick(r, 'department', 'dept'),
    location: pick(r, 'location', 'branch', 'site'),
    job_role: pick(r, 'job role', 'jobrole', 'kpi role'),
    manager_ecode: pick(r, 'reporting manager ecode', 'manager ecode', 'rm ecode',
                           'reporting manager', 'manager', 'rm'),
    work_email: pick(r, 'email', 'work email', 'official email'),
    doj: pick(r, 'date of joining', 'doj', 'joining date'),
    hr_admin: pick(r, 'hr admin', 'hradmin', 'is hr'),
  }))
  .filter(r => r.ecode && r.full_name)

console.log(`Sheet "${sheetName}": ${rows.length} usable row(s) of ${raw.length}.\n`)

if (rows.length === 0) {
  console.error('No rows had both an Ecode and a Name. Check the column headers.')
  console.error('First row keys seen:', Object.keys(raw[0] ?? {}))
  process.exit(1)
}

const dupes = rows.map(r => r.ecode.toUpperCase())
  .filter((e, i, a) => a.indexOf(e) !== i)
if (dupes.length) {
  console.error(`Duplicate ecodes in the sheet: ${[...new Set(dupes)].join(', ')}`)
  process.exit(1)
}

if (dryRun) {
  console.table(rows.slice(0, 20))
  console.log(`\nDry run — nothing was written. ${rows.length} row(s) would be imported.`)
  process.exit(0)
}

// ---- job roles --------------------------------------------------------
const roleNames = [...new Set(rows.map(r => r.job_role).filter(Boolean))]
const roleIds = {}
for (const name of roleNames) {
  const { data: existing } = await supabase
    .from('job_roles').select('id').eq('name', name).maybeSingle()
  if (existing) { roleIds[name] = existing.id; continue }
  const { data, error } = await supabase.from('job_roles').insert({ name }).select().single()
  if (error) { console.error(`  job role "${name}": ${error.message}`); continue }
  roleIds[name] = data.id
  console.log(`  + job role "${name}"`)
}

// ---- pass 1: auth users + employee rows --------------------------------
let created = 0, updated = 0, failed = 0

for (const r of rows) {
  const ecode = r.ecode.toUpperCase()
  const email = `${ecode.toLowerCase()}@${DOMAIN}`

  try {
    const { data: existingEmp } = await supabase
      .from('employees').select('id, auth_user_id').eq('ecode', ecode).maybeSingle()

    let authUserId = existingEmp?.auth_user_id ?? null

    if (!authUserId) {
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: ecode,           // initial password is the ecode itself
        email_confirm: true,
        user_metadata: { ecode, full_name: r.full_name },
      })

      if (authErr) {
        // Already there from a previous partial run — find and reuse it.
        if (/already been registered|already exists/i.test(authErr.message)) {
          const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
          authUserId = list?.users.find(u => u.email?.toLowerCase() === email)?.id ?? null
          if (!authUserId) throw new Error(`auth user ${email} exists but could not be found`)
        } else {
          throw authErr
        }
      } else {
        authUserId = authData.user.id
      }
    }

    const payload = {
      ecode,
      full_name: r.full_name,
      work_email: r.work_email,
      designation: r.designation,
      department: r.department,
      location: r.location,
      job_role_id: r.job_role ? roleIds[r.job_role] ?? null : null,
      date_of_joining: parseDate(r.doj),
      auth_user_id: authUserId,
      is_active: true,
    }
    // Never silently un-flag someone who has already set a real password.
    if (!existingEmp) payload.must_change_password = true

    const { error: upErr } = await supabase
      .from('employees').upsert(payload, { onConflict: 'ecode' })
    if (upErr) throw upErr

    if (existingEmp) { updated++; console.log(`  ~ ${ecode.padEnd(10)} ${r.full_name}`) }
    else { created++; console.log(`  + ${ecode.padEnd(10)} ${r.full_name}`) }
  } catch (err) {
    failed++
    console.error(`  ! ${ecode.padEnd(10)} ${err.message}`)
  }
}

// ---- pass 2: reporting lines ------------------------------------------
console.log('\nLinking reporting managers…')
const { data: all } = await supabase.from('employees').select('id, ecode')
const idByEcode = new Map((all ?? []).map(e => [e.ecode.toUpperCase(), e.id]))

let linked = 0, unresolved = []
for (const r of rows) {
  if (!r.manager_ecode) continue
  const mgrId = idByEcode.get(r.manager_ecode.toUpperCase())
  const selfId = idByEcode.get(r.ecode.toUpperCase())
  if (!mgrId) { unresolved.push(`${r.ecode} -> ${r.manager_ecode}`); continue }
  if (mgrId === selfId) {
    unresolved.push(`${r.ecode} reports to themselves — skipped`)
    continue
  }
  const { error } = await supabase
    .from('employees').update({ reporting_manager_id: mgrId }).eq('id', selfId)
  if (error) unresolved.push(`${r.ecode}: ${error.message}`)
  else linked++
}

// ---- pass 3: HR admins -------------------------------------------------
const hrRows = rows.filter(r => /^(y|yes|true|1)$/i.test(r.hr_admin ?? ''))
for (const r of hrRows) {
  const id = idByEcode.get(r.ecode.toUpperCase())
  if (!id) continue
  await supabase.from('user_roles').upsert(
    { employee_id: id, role: 'hr_admin' }, { onConflict: 'employee_id,role' },
  )
  console.log(`  + HR admin: ${r.ecode}`)
}

console.log(`
Done.
  created   ${created}
  updated   ${updated}
  failed    ${failed}
  managers  ${linked} linked${unresolved.length ? `, ${unresolved.length} unresolved` : ''}
`)
if (unresolved.length) {
  console.log('Unresolved reporting lines:')
  unresolved.forEach(u => console.log(`  - ${u}`))
}

function parseDate(v) {
  if (!v) return null
  // Excel serial date
  if (/^\d{5}$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
