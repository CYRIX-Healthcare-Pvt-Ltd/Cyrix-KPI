#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql in filename order, once each.
 *
 *   npm run db:push          apply anything not yet applied
 *   npm run db:verify        show what would run, change nothing
 *
 * Requires SUPABASE_DB_URL in .env.local.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

dotenv.config({ path: join(root, '.env.local') })
dotenv.config({ path: join(root, '.env') })

const DB_URL = process.env.SUPABASE_DB_URL
const verifyOnly = process.argv.includes('--verify-only')

if (!DB_URL) {
  console.error(`
  SUPABASE_DB_URL is not set.

  1. cp .env.example .env.local
  2. Supabase dashboard -> Settings -> Database -> Connection string -> URI
  3. Paste it as SUPABASE_DB_URL in .env.local (replace [YOUR-PASSWORD])
`)
  process.exit(1)
}

const migrationsDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
})

// Every migration here ends in a `do $$ ... raise notice $$` self-test, and
// those notices were being thrown away — so a test that quietly took its
// "skipped, no data to check" branch looked exactly like one that passed.
const notices = []
client.on('notice', n => { if (n.message) notices.push(n.message) })

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

try {
  await client.connect()
  console.log(`Connected. ${files.length} migration file(s) found.\n`)

  await client.query(`
    create table if not exists _migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `)

  const { rows } = await client.query('select filename, checksum from _migrations')
  const applied = new Map(rows.map(r => [r.filename, r.checksum]))

  let ran = 0
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    const checksum = sha(sql)

    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        console.log(`  ~ ${file}  ALREADY APPLIED but the file has changed since.`)
        console.log(`    Migrations are immutable — add a new numbered file instead of editing this one.`)
      } else {
        console.log(`  · ${file}  (already applied)`)
      }
      continue
    }

    if (verifyOnly) {
      console.log(`  + ${file}  WOULD APPLY`)
      ran++
      continue
    }

    process.stdout.write(`  + ${file} ... `)
    notices.length = 0
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query(
        'insert into _migrations (filename, checksum) values ($1, $2)',
        [file, checksum],
      )
      await client.query('commit')
      console.log('ok')
      for (const m of notices) console.log(`      ${m}`)
      ran++
    } catch (err) {
      await client.query('rollback')
      console.log('FAILED')
      console.error(`\n${err.message}\n`)
      if (err.position) {
        const upto = sql.slice(0, Number(err.position))
        console.error(`  near line ${upto.split('\n').length}`)
      }
      process.exit(1)
    }
  }

  console.log(
    ran === 0
      ? '\nNothing to do — database is up to date.'
      : `\n${verifyOnly ? `${ran} migration(s) pending.` : `Applied ${ran} migration(s).`}`,
  )
} finally {
  await client.end()
}
