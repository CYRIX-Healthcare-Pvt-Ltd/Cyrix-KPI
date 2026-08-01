#!/usr/bin/env node
/**
 * Switches the app out of testing mode.
 *
 *   node scripts/go-live.mjs --check    show current state, change nothing
 *   node scripts/go-live.mjs            tighten both flags
 *   node scripts/go-live.mjs --revert   back to testing mode
 *
 * Two settings are relaxed while the system is being trialled:
 *
 *   force_password_change = false
 *     Nobody is prompted to replace the password we issued, so every
 *     account still signs in with its employee code.
 *
 *   self_service_password_reset = true
 *     The login screen will reset any account back to ecode-as-password
 *     for anyone who types that employee code. It has to be callable
 *     without signing in, because the person using it cannot sign in.
 *
 * Together those are fine behind a laptop on a desk. On a public URL they
 * mean anyone who knows an employee code — and the codes run E1, E2, E3…
 * — can take over that person's account, including a manager's or HR's.
 * Run this before sharing the link outside the building.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(root, '.env.local') })

const check = process.argv.includes('--check')
const revert = process.argv.includes('--revert')

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await db.connect()

const show = async () => {
  const { rows } = await db.query(`
    select key, value::text as value from app_settings
    where key in ('force_password_change','self_service_password_reset')
    order by key`)
  const { rows: [c] } = await db.query(
    `select count(*)::int n from employees where is_active and password_is_default`)

  console.log('\n  Current state')
  console.log('  ------------------------------------------------------')
  for (const r of rows) console.log(`  ${r.key.padEnd(30)} ${r.value}`)
  console.log(`  ${'accounts still on issued default'.padEnd(30)} ${c.n}`)

  const live =
    rows.find(r => r.key === 'force_password_change')?.value === 'true' &&
    rows.find(r => r.key === 'self_service_password_reset')?.value === 'false'
  console.log(`\n  Mode: ${live ? 'LIVE (tightened)' : 'TESTING (relaxed)'}\n`)
  return live
}

if (check) {
  await show()
  await db.end()
  process.exit(0)
}

await show()

if (revert) {
  await db.query(`update app_settings set value = 'false' where key = 'force_password_change'`)
  await db.query(`update app_settings set value = 'true'  where key = 'self_service_password_reset'`)
  console.log('  Reverted to testing mode.\n')
} else {
  await db.query(`update app_settings set value = 'true'  where key = 'force_password_change'`)
  await db.query(`update app_settings set value = 'false' where key = 'self_service_password_reset'`)

  const { rows: [c] } = await db.query(
    `select count(*)::int n from employees where is_active and password_is_default`)

  console.log(`
  Live mode is on.

  - Anyone still on their issued password is now prompted to set their
    own on the next sign-in (${c.n} accounts).
  - The login screen no longer resets passwords. HR does it:
      node scripts/user-admin.mjs reset E1234

  Both changes take effect immediately — the app reads these at runtime,
  so nothing needs redeploying.
`)
}

await show()
await db.end()
