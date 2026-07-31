#!/usr/bin/env node
/**
 * Imports the employee list and creates logins.
 *
 *   node scripts/import-employees.mjs <file.xlsx|csv> [options]
 *
 *   --dry-run              parse, validate and report; write nothing
 *   --sheet <name>         pick a sheet (default: first)
 *   --include-inactive     also import leavers, as is_active=false with NO login
 *   --hr-admin <CODE>      create/flag this code as an HR admin
 *   --limit <n>            import only the first n rows (for a trial run)
 *
 * Columns are matched loosely and case-insensitively. Recognised:
 *   Employee_Code / Ecode / Emp Code        (required)
 *   Employee_Name / Name                    (required)
 *   Employee_Status / Status                (leavers are skipped by default)
 *   ReportingManager_Code / Manager Ecode
 *   Designation | Department | Location | Job Role | Email | Date of Joining
 *
 * Each imported active employee gets a Supabase Auth user
 * <ecode>@cyrix.local with the ecode as the initial password, flagged to
 * force a change on first login.
 *
 * Re-running is safe: existing ecodes are updated rather than duplicated,
 * and an existing password is never reset.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY — it bypasses RLS entirely, so run this
 * locally and never expose the key to a browser.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })
dotenv.config({ path: join(root, '.env') })

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DOMAIN = process.env.VITE_AUTH_EMAIL_DOMAIN || 'cyrix.local'

const argv = process.argv.slice(2)
const flag = n => argv.includes(n)
const opt = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null)

const file = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)
const dryRun = flag('--dry-run')
const includeInactive = flag('--include-inactive')
const hrAdminCode = opt('--hr-admin')
const limit = opt('--limit') ? Number(opt('--limit')) : null
const sheetArg = opt('--sheet')

if (!file) {
  console.error('Usage: node scripts/import-employees.mjs <file.xlsx|csv> [--dry-run] [--hr-admin CODE]')
  process.exit(1)
}
if (!dryRun && (!URL || !KEY)) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// ---------------------------------------------------------------------
// Read and normalise
// ---------------------------------------------------------------------
const norm = s => String(s ?? '').trim()
const keyify = s => norm(s).toLowerCase().replace(/[^a-z0-9]/g, '')

function pick(row, ...candidates) {
  const map = Object.fromEntries(Object.keys(row).map(k => [keyify(k), k]))
  for (const c of candidates) {
    const hit = map[keyify(c)]
    if (hit && row[hit] !== null && norm(row[hit]) !== '') return norm(row[hit])
  }
  return null
}

/**
 * Anyone mid-exit or already gone. Being generous here is deliberate:
 * wrongly creating a login for a leaver is far worse than missing one,
 * which is a one-line fix in the sheet and a re-run.
 */
const LEAVER = /fnf|resign|exit|terminat|abscond|left|retire|deceas|separat|inactive|relieved/i
const isActive = status => !LEAVER.test(status ?? '')

const wb = XLSX.readFile(file)
const sheetName = sheetArg && wb.SheetNames.includes(sheetArg) ? sheetArg : wb.SheetNames[0]
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null })

let parsed = raw.map((r, i) => ({
  rowNum: i + 2,
  ecode: pick(r, 'employee_code', 'employee code', 'ecode', 'emp code', 'empcode', 'code', 'empid', 'employee id'),
  full_name: pick(r, 'employee_name', 'employee name', 'name', 'full name', 'tm name'),
  status: pick(r, 'employee_status', 'employee status', 'status', 'emp status'),
  manager_ecode: pick(r,
    'reportingmanager_code', 'reporting manager code', 'reportingmanagercode',
    'reporting manager ecode', 'manager code', 'manager ecode', 'rm code', 'rm ecode',
    'reporting manager', 'manager', 'rm'),
  manager_name: pick(r, 'reportingmanager_name', 'reporting manager name', 'manager name'),
  designation: pick(r, 'designation', 'title', 'role'),
  department: pick(r, 'department', 'dept'),
  location: pick(r, 'location', 'branch', 'site'),
  job_role: pick(r, 'job role', 'jobrole', 'kpi role'),
  work_email: pick(r, 'email', 'work email', 'official email', 'email id'),
  doj: pick(r, 'date of joining', 'doj', 'joining date', 'date_of_joining'),
  hr_admin: pick(r, 'hr admin', 'hradmin', 'is hr'),
})).filter(r => r.ecode && r.full_name)

const active = parsed.filter(r => isActive(r.status))
const inactive = parsed.filter(r => !isActive(r.status))

let toImport = includeInactive ? parsed : active
if (limit) toImport = toImport.slice(0, limit)

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------
console.log(`\nSheet "${sheetName}" — ${raw.length} rows, ${parsed.length} with a code and a name.\n`)

const statuses = {}
for (const r of parsed) statuses[r.status || '(blank)'] = (statuses[r.status || '(blank)'] || 0) + 1
console.log('Status breakdown:')
Object.entries(statuses).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
  console.log(`  ${String(v).padStart(5)}  ${k}${isActive(k) ? '' : '   (leaver — no login)'}`))

console.log(`\n  active:   ${active.length}`)
console.log(`  leavers:  ${inactive.length}`)
console.log(`  importing: ${toImport.length}${includeInactive ? ' (including leavers, no logins for them)' : ' (active only)'}`)
if (limit) console.log(`  limited to first ${limit} by --limit`)

// ---- validation ----
const seen = new Map()
const dupes = []
for (const r of toImport) {
  const k = r.ecode.toUpperCase()
  if (seen.has(k)) dupes.push(`${r.ecode} (rows ${seen.get(k)} and ${r.rowNum})`)
  else seen.set(k, r.rowNum)
}
if (dupes.length) {
  console.error(`\nDuplicate employee codes — fix the sheet first:`)
  dupes.slice(0, 20).forEach(d => console.error(`  ${d}`))
  process.exit(1)
}

const importable = new Set(toImport.map(r => r.ecode.toUpperCase()))
const selfManaged = toImport.filter(r =>
  r.manager_ecode && r.manager_ecode.toUpperCase() === r.ecode.toUpperCase())
const dangling = toImport.filter(r =>
  r.manager_ecode &&
  r.manager_ecode.toUpperCase() !== r.ecode.toUpperCase() &&
  !importable.has(r.manager_ecode.toUpperCase()))

console.log(`\nReporting lines:`)
console.log(`  will be linked:                ${toImport.filter(r => r.manager_ecode && !selfManaged.includes(r) && !dangling.includes(r)).length}`)
console.log(`  top of tree (self-managed):    ${selfManaged.length}${selfManaged.length ? '  -> ' + selfManaged.map(r => r.ecode).slice(0, 5).join(', ') : ''}`)
console.log(`  manager not being imported:    ${dangling.length}`)
if (dangling.length) {
  console.log(`    (these people will have no manager and cannot have their KPI approved)`)
  dangling.slice(0, 10).forEach(r =>
    console.log(`    ${r.ecode.padEnd(8)} ${r.full_name} -> ${r.manager_ecode} ${r.manager_name ?? ''}`))
}

const managerCodes = new Set(
  toImport.map(r => r.manager_ecode?.toUpperCase()).filter(c => c && importable.has(c)))
console.log(`\n  people who will BE managers:   ${managerCodes.size}`)

if (hrAdminCode) {
  const clash = parsed.find(r => r.ecode.toUpperCase() === hrAdminCode.toUpperCase())
  console.log(`\nHR admin: ${hrAdminCode}${clash ? `  (matches existing employee "${clash.full_name}")` : '  (new standalone account)'}`)
}

if (dryRun) {
  console.log('\nSample of what would be imported:')
  console.table(toImport.slice(0, 10).map(({ rowNum, manager_name, hr_admin, ...r }) => {
    void rowNum; void manager_name; void hr_admin
    return r
  }))
  console.log(`\nDry run — nothing was written.\n`)
  process.exit(0)
}

// ---------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------
const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const emailFor = ecode => `${ecode.toLowerCase()}@${DOMAIN}`
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// ---- job roles --------------------------------------------------------
const roleIds = {}
for (const name of [...new Set(toImport.map(r => r.job_role).filter(Boolean))]) {
  const { data: found } = await supabase.from('job_roles').select('id').eq('name', name).maybeSingle()
  if (found) { roleIds[name] = found.id; continue }
  const { data, error } = await supabase.from('job_roles').insert({ name }).select().single()
  if (error) console.error(`  job role "${name}": ${error.message}`)
  else { roleIds[name] = data.id; console.log(`  + job role "${name}"`) }
}

// ---- existing state ---------------------------------------------------
console.log('\nLoading existing records…')
const existing = new Map()
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('employees')
    .select('id, ecode, auth_user_id, must_change_password')
    .range(from, from + 999)
  if (error) { console.error(error.message); process.exit(1) }
  data.forEach(e => existing.set(e.ecode.toUpperCase(), e))
  if (data.length < 1000) break
}
console.log(`  ${existing.size} already in the database`)

// Auth users, so a half-finished previous run can be resumed cleanly.
const authByEmail = new Map()
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) { console.error(error.message); break }
  data.users.forEach(u => u.email && authByEmail.set(u.email.toLowerCase(), u.id))
  if (data.users.length < 1000) break
}
console.log(`  ${authByEmail.size} auth users already exist`)

// ---- create auth users ------------------------------------------------
// Leavers never get a login, even when --include-inactive imports them.
const needAuth = toImport.filter(r =>
  isActive(r.status) &&
  !existing.get(r.ecode.toUpperCase())?.auth_user_id &&
  !authByEmail.has(emailFor(r.ecode)))

console.log(`\nCreating ${needAuth.length} login(s)…`)
let made = 0, authFailed = []

async function createAuth(r, attempt = 1) {
  const ecode = r.ecode.toUpperCase()
  const email = emailFor(ecode)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: ecode,                      // initial password is the ecode
    email_confirm: true,
    user_metadata: { ecode, full_name: r.full_name },
  })
  if (!error) { authByEmail.set(email, data.user.id); return }

  if (/already been registered|already exists/i.test(error.message)) {
    const { data: found } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    void found
    return                                 // picked up by the reconcile pass below
  }
  // Auth admin endpoints rate-limit; back off rather than losing the row.
  if (attempt < 4 && /rate|429|timeout|fetch failed/i.test(error.message)) {
    await new Promise(res => setTimeout(res, 500 * attempt * attempt))
    return createAuth(r, attempt + 1)
  }
  authFailed.push(`${ecode}: ${error.message}`)
}

const CONCURRENCY = 4
for (const batch of chunk(needAuth, CONCURRENCY)) {
  await Promise.all(batch.map(createAuth))
  made += batch.length
  if (made % 100 < CONCURRENCY) process.stdout.write(`\r  ${made}/${needAuth.length}`)
}
process.stdout.write(`\r  ${needAuth.length}/${needAuth.length}\n`)

// Refresh the email -> id map so every row can be linked.
if (needAuth.length) {
  authByEmail.clear()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    data.users.forEach(u => u.email && authByEmail.set(u.email.toLowerCase(), u.id))
    if (data.users.length < 1000) break
  }
}

// ---- upsert employees -------------------------------------------------
console.log(`\nUpserting ${toImport.length} employee record(s)…`)
let upserted = 0, upsertFailed = []

for (const batch of chunk(toImport, 500)) {
  const payload = batch.map(r => {
    const ecode = r.ecode.toUpperCase()
    const prior = existing.get(ecode)
    const row = {
      ecode,
      full_name: r.full_name,
      work_email: r.work_email,
      designation: r.designation,
      department: r.department,
      location: r.location,
      job_role_id: r.job_role ? roleIds[r.job_role] ?? null : null,
      date_of_joining: parseDate(r.doj),
      auth_user_id: authByEmail.get(emailFor(ecode)) ?? prior?.auth_user_id ?? null,
      is_active: isActive(r.status),
      // Carried through rather than conditionally omitted: PostgREST needs
      // every object in a batch upsert to have identical keys, and a missing
      // key is sent as NULL, which violates the NOT NULL constraint. Reusing
      // the prior value also avoids re-forcing a password change on someone
      // who has already set a real one.
      must_change_password: prior ? prior.must_change_password : true,
    }
    return row
  })

  const { error } = await supabase.from('employees').upsert(payload, { onConflict: 'ecode' })
  if (error) upsertFailed.push(error.message)
  else upserted += batch.length
  process.stdout.write(`\r  ${upserted}/${toImport.length}`)
}
process.stdout.write('\n')

// ---- reporting lines --------------------------------------------------
console.log('\nLinking reporting managers…')
const idByEcode = new Map()
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('employees').select('id, ecode').range(from, from + 999)
  if (error) break
  data.forEach(e => idByEcode.set(e.ecode.toUpperCase(), e.id))
  if (data.length < 1000) break
}

// Grouped by manager so each call is a plain UPDATE over a list of ecodes.
// Deliberately NOT an upsert: an upsert on an ecode that does not exist yet
// would INSERT a half-built row with no name and fail the NOT NULL check.
const byManager = new Map()
let skippedLinks = 0
for (const r of toImport) {
  if (!r.manager_ecode) continue
  const me = r.ecode.toUpperCase()
  const mgr = r.manager_ecode.toUpperCase()
  if (me === mgr) continue                       // top of the tree
  const mgrId = idByEcode.get(mgr)
  if (!mgrId || !idByEcode.get(me)) { skippedLinks++; continue }
  if (!byManager.has(mgrId)) byManager.set(mgrId, [])
  byManager.get(mgrId).push(me)
}

const totalLinks = [...byManager.values()].reduce((a, b) => a + b.length, 0)
let linked = 0
for (const [mgrId, ecodes] of byManager) {
  for (const batch of chunk(ecodes, 200)) {
    const { error } = await supabase
      .from('employees')
      .update({ reporting_manager_id: mgrId })
      .in('ecode', batch)
    if (error) console.error(`\n  ${error.message}`)
    else linked += batch.length
    process.stdout.write(`\r  ${linked}/${totalLinks}`)
  }
}
process.stdout.write('\n')
if (skippedLinks) console.log(`  ${skippedLinks} link(s) skipped — employee or manager missing`)

// ---- HR admins --------------------------------------------------------
const hrFromSheet = toImport.filter(r => /^(y|yes|true|1)$/i.test(r.hr_admin ?? ''))
if (hrAdminCode || hrFromSheet.length) {
  console.log('\nHR admins…')

  if (hrAdminCode) {
    const code = hrAdminCode.toUpperCase()
    let id = idByEcode.get(code)

    if (!id) {
      // Standalone HR account that is not in the employee sheet.
      const email = emailFor(code)
      let authId = authByEmail.get(email)
      if (!authId) {
        const { data, error } = await supabase.auth.admin.createUser({
          email, password: hrAdminCode, email_confirm: true,
          user_metadata: { ecode: code, full_name: 'HR Administrator' },
        })
        if (error) console.error(`  ! ${code}: ${error.message}`)
        else authId = data.user.id
      }
      if (authId) {
        const { data, error } = await supabase.from('employees').upsert({
          ecode: code,
          full_name: 'HR Administrator',
          designation: 'HR Administrator',
          auth_user_id: authId,
          is_active: true,
          must_change_password: true,
        }, { onConflict: 'ecode' }).select().single()
        if (error) console.error(`  ! ${code}: ${error.message}`)
        else { id = data.id; console.log(`  + created account ${hrAdminCode}`) }
      }
    }

    if (id) {
      const { error } = await supabase.from('user_roles')
        .upsert({ employee_id: id, role: 'hr_admin' }, { onConflict: 'employee_id,role' })
      console.log(error ? `  ! ${code}: ${error.message}` : `  + ${hrAdminCode} granted hr_admin`)
    }
  }

  for (const r of hrFromSheet) {
    const id = idByEcode.get(r.ecode.toUpperCase())
    if (!id) continue
    await supabase.from('user_roles')
      .upsert({ employee_id: id, role: 'hr_admin' }, { onConflict: 'employee_id,role' })
    console.log(`  + ${r.ecode} granted hr_admin`)
  }
}

// ---- summary ----------------------------------------------------------
console.log(`
Done.
  employees upserted   ${upserted}
  logins created       ${needAuth.length - authFailed.length}
  manager links        ${linked}
  leavers skipped      ${includeInactive ? 0 : inactive.length}
`)
if (authFailed.length) {
  console.log(`Logins that failed (${authFailed.length}):`)
  authFailed.slice(0, 20).forEach(f => console.log(`  - ${f}`))
}
if (upsertFailed.length) {
  console.log(`Upsert errors:`)
  upsertFailed.slice(0, 10).forEach(f => console.log(`  - ${f}`))
}

function parseDate(v) {
  if (!v) return null
  if (/^\d{5}$/.test(v)) {                        // Excel serial
    return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000).toISOString().slice(0, 10)
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
