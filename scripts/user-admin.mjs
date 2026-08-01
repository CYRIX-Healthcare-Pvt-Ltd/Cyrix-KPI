#!/usr/bin/env node
/**
 * Login administration for HR.
 *
 *   node scripts/user-admin.mjs status              overall summary
 *   node scripts/user-admin.mjs status E551         one person
 *   node scripts/user-admin.mjs pending             who has never signed in
 *   node scripts/user-admin.mjs reset E551          reset password back to the ecode
 *   node scripts/user-admin.mjs reset E551 --to "SomePass123"
 *   node scripts/user-admin.mjs reset-all          every active account -> its ecode
 *
 * NOTE ON PASSWORDS
 * -----------------
 * Passwords cannot be looked up. Supabase stores a bcrypt hash in
 * auth.users.encrypted_password, which is deliberately one-way — there is
 * no column, view or API anywhere that returns the plaintext, and that is
 * a feature, not a gap. Even a database superuser cannot read one back.
 *
 * So "what is this person's password?" is not an answerable question.
 * The answerable ones are "have they signed in?", "have they changed it
 * from the default?" and "reset it for them", which is what this covers.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DOMAIN = process.env.VITE_AUTH_EMAIL_DOMAIN || 'cyrix.local'

const [cmd, target, ...rest] = process.argv.slice(2)
const toOpt = rest.includes('--to') ? rest[rest.indexOf('--to') + 1] : null

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await db.connect()

const fmt = d => (d ? new Date(d).toLocaleString('en-GB') : '—')

// ---------------------------------------------------------------------
if (!cmd || cmd === 'status') {
  if (target) {
    const { rows } = await db.query(`
      select e.ecode, e.full_name, e.is_active, e.must_change_password,
             u.email, u.last_sign_in_at, u.created_at, u.updated_at,
             left(u.encrypted_password, 7) as hash_prefix,
             length(u.encrypted_password) as hash_len,
             m.ecode as manager_ecode, m.full_name as manager_name
      from employees e
      left join auth.users u on u.id = e.auth_user_id
      left join employees m on m.id = e.reporting_manager_id
      where upper(e.ecode) = upper($1)`, [target])

    if (!rows.length) {
      console.log(`\nNo employee with code "${target}".\n`)
      process.exit(1)
    }
    const r = rows[0]
    console.log(`
  ${r.ecode}  ${r.full_name}
  ------------------------------------------------------------
  active                 ${r.is_active}
  login email            ${r.email ?? '(no login)'}
  reporting manager      ${r.manager_ecode ? `${r.manager_ecode} ${r.manager_name}` : '— top of tree'}

  password stored as     ${r.hash_prefix ? `${r.hash_prefix}… (bcrypt, ${r.hash_len} chars)` : '—'}
  still on the default   ${r.must_change_password ? 'YES — has not set their own yet' : 'no — they have set their own'}
  account created        ${fmt(r.created_at)}
  password last changed  ${fmt(r.updated_at)}
  last signed in         ${fmt(r.last_sign_in_at)}

  The password itself cannot be read back. To get this person in,
  reset it:  node scripts/user-admin.mjs reset ${r.ecode}
`)
  } else {
    const { rows } = await db.query(`
      select count(*)                                              as total,
             count(*) filter (where e.must_change_password)        as on_default,
             count(*) filter (where not e.must_change_password)    as own_password,
             count(*) filter (where u.last_sign_in_at is not null) as signed_in,
             count(*) filter (where u.last_sign_in_at is null)     as never_signed_in
      from employees e left join auth.users u on u.id = e.auth_user_id
      where e.is_active`)
    const r = rows[0]
    console.log(`
  Active accounts        ${r.total}
  ------------------------------------------------------------
  have signed in         ${r.signed_in}
  never signed in        ${r.never_signed_in}
  still on ecode default ${r.on_default}
  set their own password ${r.own_password}

  Passwords are bcrypt hashes and cannot be read back — not from the
  dashboard, not from SQL, not by anyone. Use "reset" to issue a new one.
`)
  }
  await db.end()
  process.exit(0)
}

// ---------------------------------------------------------------------
if (cmd === 'pending') {
  const { rows } = await db.query(`
    select e.ecode, e.full_name, m.ecode as mgr
    from employees e
    left join auth.users u on u.id = e.auth_user_id
    left join employees m on m.id = e.reporting_manager_id
    where e.is_active and u.last_sign_in_at is null
    order by e.ecode limit 60`)
  console.log(`\n${rows.length} shown — active people who have never signed in:\n`)
  rows.forEach(r =>
    console.log(`  ${r.ecode.padEnd(10)} ${String(r.full_name).padEnd(30)} mgr ${r.mgr ?? '—'}`))
  console.log('')
  await db.end()
  process.exit(0)
}

// ---------------------------------------------------------------------
// Issues a login for an employee record that has none — the case after
// HR adds someone through the admin screen, which cannot create auth
// users itself because that needs the service role.
if (cmd === 'issue-login') {
  if (!target) {
    console.error('Usage: node scripts/user-admin.mjs issue-login <ECODE>')
    process.exit(1)
  }
  if (!URL || !KEY) {
    console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const { rows } = await db.query(
    `select id, ecode, full_name, auth_user_id, is_active
     from employees where upper(ecode) = upper($1)`, [target])
  if (!rows.length) {
    console.error(`No employee with code "${target}".`)
    process.exit(1)
  }
  const emp = rows[0]
  if (emp.auth_user_id) {
    console.log(`\n  ${emp.ecode} already has a login. Use "reset" to change the password.\n`)
    await db.end()
    process.exit(0)
  }
  if (!emp.is_active) {
    console.error(`${emp.ecode} is not active — reactivate them first.`)
    process.exit(1)
  }

  const ecode = emp.ecode.toUpperCase()
  const supabase = createClient(URL, KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.auth.admin.createUser({
    email: `${ecode.toLowerCase()}@${DOMAIN}`,
    password: ecode,
    email_confirm: true,
    user_metadata: { ecode, full_name: emp.full_name },
  })
  if (error) {
    console.error(`Could not create the login: ${error.message}`)
    process.exit(1)
  }

  await db.query(
    `update employees set auth_user_id = $1 where id = $2`, [data.user.id, emp.id])

  console.log(`
  Login issued.

  ${ecode}  ${emp.full_name}
  signs in with   ${ecode}  /  ${ecode}
`)
  await db.end()
  process.exit(0)
}

// ---------------------------------------------------------------------
if (cmd === 'reset-all') {
  const { rows: cfg } = await db.query(
    `select key, value from app_settings
     where key in ('force_password_change','self_service_password_reset')`)
  const settings = Object.fromEntries(cfg.map(r => [r.key, r.value]))

  const { rows: [{ n }] } = await db.query(
    `select count(*)::int n from employees where is_active and auth_user_id is not null`)

  console.log(`\n  About to reset ${n} active account(s) to ecode-as-password.`)
  console.log(`  force_password_change is ${settings.force_password_change}`)

  // Done in one statement rather than n API calls. pgcrypto's bcrypt
  // output is byte-identical in format to what GoTrue writes, so the
  // new passwords validate on the next sign-in.
  const { rowCount } = await db.query(`
    update auth.users u
    set encrypted_password = extensions.crypt(
          upper(e.ecode), extensions.gen_salt('bf', 10)),
        updated_at = now()
    from employees e
    where e.auth_user_id = u.id and e.is_active`)

  // Match the flag: no point forcing a change during the testing phase.
  // password_is_default goes back to true: every account is once again on
  // the code we issued, whatever it had been changed to.
  const forced = String(settings.force_password_change) === 'true'
  await db.query(
    `update employees
     set must_change_password = $1, password_is_default = true
     where is_active`, [forced])

  await db.query(`
    insert into audit_log (entity_type, action, details)
    values ('system', 'bulk_password_reset', $1::jsonb)`,
    [JSON.stringify({ accounts: rowCount, via: 'user-admin.mjs' })])

  console.log(`
  Reset ${rowCount} account(s).

  Everyone now signs in with their employee code as both id and password,
  e.g. E551 / E551. must_change_password is ${forced}.

  Before go-live, tighten both flags:
    update app_settings set value = 'true'  where key = 'force_password_change';
    update app_settings set value = 'false' where key = 'self_service_password_reset';
`)
  await db.end()
  process.exit(0)
}

// ---------------------------------------------------------------------
if (cmd === 'reset') {
  if (!target) {
    console.error('Usage: node scripts/user-admin.mjs reset <ECODE> [--to "NewPassword"]')
    process.exit(1)
  }
  if (!URL || !KEY) {
    console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const { rows } = await db.query(
    `select id, ecode, full_name, auth_user_id from employees where upper(ecode) = upper($1)`,
    [target])
  if (!rows.length) {
    console.error(`No employee with code "${target}".`)
    process.exit(1)
  }
  const emp = rows[0]
  if (!emp.auth_user_id) {
    console.error(`${emp.ecode} has no login to reset.`)
    process.exit(1)
  }

  const newPassword = toOpt || emp.ecode.toUpperCase()
  const supabase = createClient(URL, KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await supabase.auth.admin.updateUserById(emp.auth_user_id, {
    password: newPassword,
  })
  if (error) {
    console.error(`Could not reset: ${error.message}`)
    process.exit(1)
  }

  // Back on an issued password, and prompted to choose their own again.
  await db.query(
    `update employees
     set must_change_password = true, password_is_default = true
     where id = $1`, [emp.id])

  console.log(`
  Reset done.

  ${emp.ecode}  ${emp.full_name}
  signs in with   ${emp.ecode.toUpperCase()}  /  ${newPassword}
  and will be forced to set their own password immediately.

  Tell them over a channel you trust, not email if you can avoid it.
`)
  await db.end()
  process.exit(0)
}

console.error(`Unknown command "${cmd}". Try: status | pending | reset | reset-all`)
await db.end()
process.exit(1)
