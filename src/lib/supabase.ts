import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env.local and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/**
 * Ecodes are the login id, but Supabase Auth needs an email. We map
 * E1042 -> e1042@cyrix.local. The address never receives mail; it is
 * purely an internal identifier so we get real JWTs and working RLS.
 */
const AUTH_DOMAIN = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || 'cyrix.local'

export const ecodeToEmail = (ecode: string) =>
  `${ecode.trim().toLowerCase()}@${AUTH_DOMAIN}`

/** Turns Postgres exceptions from our RPCs into something readable. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.'
  const msg =
    typeof err === 'string'
      ? err
      : (err as { message?: string }).message ?? String(err)

  if (msg.includes('Invalid login credentials')) {
    return 'Wrong employee code or password.'
  }
  if (msg.includes('duplicate key') && msg.includes('idx_assignment_one_live')) {
    return 'A KPI already exists for this employee for that financial year.'
  }
  if (msg.includes('row-level security') || msg.includes('Not permitted')) {
    return 'You do not have access to this.'
  }
  // Our RPCs raise plain-English messages; strip the Postgres prefix.
  return msg.replace(/^(ERROR|error):\s*/i, '')
}
