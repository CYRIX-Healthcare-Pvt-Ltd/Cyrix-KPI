import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Gives a login to anybody on the payroll who has not got one.
 *
 * The employee import has always created records and not accounts, so
 * every master upload ended with "now run this script" and a new joiner
 * could not sign in until somebody with the service key remembered. The
 * reason was real: making an account needs auth.admin.createUser, that
 * needs the service role key, and a service role key in a browser is a
 * service role key in everybody's browser.
 *
 * An edge function is where that key is allowed to live. This is the
 * same work scripts/import-employees.mjs does, in the same shape and
 * with the same conventions -- <ecode>@cyrix.local, the employee code as
 * the first password, forced to change on first sign-in -- so the two
 * cannot drift into making different kinds of account.
 *
 * Deploy:  supabase functions deploy create-logins
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both injected)
 *          AUTH_EMAIL_DOMAIN, optional, defaults to cyrix.local
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

const DOMAIN = Deno.env.get('AUTH_EMAIL_DOMAIN') ?? 'cyrix.local'
const emailFor = (ecode: string) => `${ecode.toLowerCase()}@${DOMAIN}`

/**
 * How many accounts one call will make.
 *
 * The auth admin endpoints rate-limit and each account is a round trip,
 * so a thousand of them would run past the wall clock and leave the job
 * half done with no way to tell how far it got. The caller is handed
 * `remaining` and comes back for the rest, which also means a joiner
 * batch of six costs one call.
 */
const PER_CALL = 200
const CONCURRENCY = 4

const callerFromToken = (req: Request): string | null => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const c = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as
      { sub?: string; role?: string; exp?: number }
    if (c.role !== 'authenticated' || !c.sub) return null
    if (c.exp && c.exp * 1000 < Date.now()) return null
    return c.sub
  } catch {
    return null
  }
}

interface Row { id: string; ecode: string; full_name: string }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const uid = callerFromToken(req)
  if (!uid) return json({ ok: false, error: 'Sign in again' }, 401)

  const db = admin()

  // Making accounts is HR's job and nobody else's. Checked against the
  // caller's own row rather than anything they sent.
  const { data: me } = await db.from('employees')
    .select('id').eq('auth_user_id', uid).maybeSingle()
  if (!me) return json({ ok: false, error: 'No employee record for this login' }, 403)
  const { data: role } = await db.from('user_roles')
    .select('role').eq('employee_id', me.id).eq('role', 'hr_admin').maybeSingle()
  if (!role) return json({ ok: false, error: 'Only HR Admin can create logins' }, 403)

  // Everybody active with no account, oldest record first so a repeated
  // call works through them in a stable order.
  const { data: pending, error: pendErr } = await db.from('employees')
    .select('id, ecode, full_name')
    .is('auth_user_id', null).eq('is_active', true)
    .order('created_at', { ascending: true })
  if (pendErr) return json({ ok: false, error: pendErr.message }, 500)

  const all = (pending ?? []) as Row[]
  const batch = all.slice(0, PER_CALL)
  const created: string[] = []
  const failed: string[] = []

  /** Finds an account that already exists, so a half-linked row heals. */
  const findExisting = async (email: string): Promise<string | null> => {
    for (let page = 1; page <= 5; page++) {
      const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 })
      const hit = data?.users.find(u => (u.email ?? '').toLowerCase() === email)
      if (hit) return hit.id
      if (!data || data.users.length < 1000) return null
    }
    return null
  }

  const makeOne = async (r: Row, attempt = 1): Promise<void> => {
    const ecode = r.ecode.toUpperCase()
    const email = emailFor(ecode)
    const { data, error } = await db.auth.admin.createUser({
      email,
      // The employee code, exactly as the script does it, and forced to
      // change below. Two ways of starting an account would be two
      // things for somebody to be told on their first day.
      password: ecode,
      email_confirm: true,
      user_metadata: { ecode, full_name: r.full_name },
    })

    let authId = data?.user?.id ?? null

    if (error) {
      if (/already been registered|already exists/i.test(error.message)) {
        // The account is there and the employee row simply is not
        // pointing at it. Link rather than report a failure.
        authId = await findExisting(email)
        if (!authId) { failed.push(`${ecode}: account exists but could not be found`); return }
      } else if (attempt < 4 && /rate|429|timeout|fetch failed/i.test(error.message)) {
        await new Promise(res => setTimeout(res, 400 * attempt * attempt))
        return makeOne(r, attempt + 1)
      } else {
        failed.push(`${ecode}: ${error.message}`)
        return
      }
    }
    if (!authId) { failed.push(`${ecode}: no account id came back`); return }

    const { error: linkErr } = await db.from('employees')
      .update({ auth_user_id: authId, must_change_password: true })
      .eq('id', r.id)
    if (linkErr) { failed.push(`${ecode}: ${linkErr.message}`); return }
    created.push(ecode)
  }

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(r => makeOne(r)))
  }

  return json({
    ok: true,
    created,
    failed,
    // What is left after this call, so the caller knows to come back.
    remaining: Math.max(0, all.length - batch.length),
    domain: DOMAIN,
  })
})
