import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * The only thing in this system that may email a one-time code, and the
 * only thing that may set somebody's password without their old one.
 *
 * It lives out here rather than in the browser for the obvious reason —
 * a code the client generates is a code the client already knows — and
 * out of Postgres for the other one: the database has no business
 * holding a mail provider's key.
 *
 * Two actions, two flows through them:
 *
 *   reset   Nobody is signed in. The employee code comes from the form,
 *           and every answer is the same sentence whether or not that
 *           person exists. Replaces the old behaviour, where "forgot
 *           password" set an account back to its own employee code and
 *           the only thing you needed to take somebody's account was to
 *           read their badge.
 *
 *   change  Somebody is signed in and we know who from their token, not
 *           from anything they typed. Here the answers are truthful:
 *           telling you about your own record is not a leak, and "that
 *           is not the address we have for you" is the whole point.
 *
 * Deploy:  supabase functions deploy password-otp
 * Secrets: supabase secrets set RESEND_API_KEY=... OTP_FROM='Cyrix KPI <no-reply@cyrix.in>'
 *          (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
 *           are injected by the platform. None of them ever go near a
 *           VITE_ variable.)
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

/**
 * What a stranger is told, whatever happened.
 *
 * Wrong employee code, right code but wrong address, no address on
 * record, rate limited — all of it comes back as this. Anything more
 * specific turns the reset form into a way to find out who works here
 * and what their address is, and the employee codes are on badges.
 */
const NEUTRAL =
  'If that employee code and email match our records, a code is on its way. ' +
  'It expires in 10 minutes.'

/**
 * Six digits, without the bias that `% 1000000` on a raw 32-bit number
 * quietly introduces — 2^32 is not a multiple of a million, so the first
 * 967,296 codes would come up fractionally more often than the rest.
 * Rejection sampling costs one extra draw about 0.02% of the time.
 */
function sixDigitCode(): string {
  const ceiling = Math.floor(0xffffffff / 1_000_000) * 1_000_000
  const buf = new Uint32Array(1)
  let n: number
  do {
    crypto.getRandomValues(buf)
    n = buf[0]
  } while (n >= ceiling)
  return String(n % 1_000_000).padStart(6, '0')
}

const MIN_PASSWORD = 8

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

/** Who is calling, from their token rather than from what they typed. */
async function signedInEcode(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const asThem = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  )
  const { data, error } = await asThem.auth.getUser()
  if (error || !data.user) return null
  const { data: emp } = await admin()
    .from('employees').select('ecode')
    .eq('auth_user_id', data.user.id).maybeSingle()
  return emp?.ecode ?? null
}

/**
 * Who the code appears to come from.
 *
 * The setting first, the secret second. Changing an edge-function secret
 * needs the CLI, a login and a redeploy, and the moment this needs
 * changing is the moment somebody is locked out — so SW Admin owns it
 * from the admin screen and the secret is only the fallback for a
 * deployment nobody has told anything.
 */
async function senderAddress(db: ReturnType<typeof admin>): Promise<string> {
  try {
    const { data } = await db.rpc('otp_sender')
    if (typeof data === 'string' && data.includes('@')) return data
  } catch { /* fall through to the secret */ }
  return Deno.env.get('OTP_FROM') ?? 'Cyrix KPI <no-reply@send.cyrix.in>'
}

async function sendCode(
  db: ReturnType<typeof admin>,
  to: string, name: string, code: string, purpose: string,
) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) throw new Error('RESEND_API_KEY is not set')
  const from = await senderAddress(db)

  const what = purpose === 'reset' ? 'reset your password' : 'change your password'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${code} is your Cyrix KPI code`,
      // Plain text as well as HTML: a code is exactly the kind of mail
      // somebody reads on a locked-down phone client that strips styling.
      text:
        `Hello ${name},\n\n${code}\n\n` +
        `Use this code to ${what}. It expires in 10 minutes.\n\n` +
        `If you did not ask for this, you can ignore this email — ` +
        `nothing has changed on your account. Tell HR if it keeps happening.\n`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px">` +
        `<p style="color:#39424e">Hello ${name},</p>` +
        `<p style="font-size:34px;font-weight:700;letter-spacing:.18em;margin:24px 0;color:#0b0d10">${code}</p>` +
        `<p style="color:#39424e">Use this code to ${what}. It expires in 10 minutes.</p>` +
        `<p style="color:#8792a2;font-size:13px">If you did not ask for this you can ignore this email — ` +
        `nothing has changed on your account. Tell HR if it keeps happening.</p></div>`,
    }),
  })

  if (!res.ok) throw new Error(`Resend refused: ${res.status} ${await res.text()}`)
}

/**
 * A test that cannot be mistaken for the real thing.
 *
 * Deliberately not a six-digit code. The target is now a named
 * colleague rather than the admin themselves, and a message reading
 * "482913 is your Cyrix KPI code" landing unannounced in somebody's
 * inbox says exactly one thing to them: somebody is trying to get into
 * my account. That is a support call and a scare, from a button meant to
 * check a DNS record.
 */
async function sendTest(db: ReturnType<typeof admin>, to: string, name: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) throw new Error('RESEND_API_KEY is not set')
  const from = await senderAddress(db)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Test message from Cyrix KPI — no action needed',
      text:
        `Hello ${name},\n\n` +
        `This is a test. Somebody in IT is checking that Cyrix KPI can reach ` +
        `your email address, so that password codes work when you need one.\n\n` +
        `Nothing has changed on your account and there is nothing to do. ` +
        `You can delete this.\n`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px">` +
        `<p style="color:#39424e">Hello ${name},</p>` +
        `<p style="color:#39424e"><strong>This is a test.</strong> Somebody in IT is checking ` +
        `that Cyrix KPI can reach your email address, so that password codes work when ` +
        `you need one.</p>` +
        `<p style="color:#8792a2;font-size:13px">Nothing has changed on your account and ` +
        `there is nothing to do. You can delete this.</p></div>`,
    }),
  })

  if (!res.ok) throw new Error(`Resend refused: ${res.status} ${await res.text()}`)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected JSON' }, 400)
  }

  const purpose = body.purpose === 'change' ? 'change' : 'reset'
  const signedIn = purpose === 'change' || body.action === 'test'

  // For a signed-in change the identity comes from the token. Letting
  // the body name the account would make this a way to reset anybody's
  // password from any logged-in account.
  const ecode = signedIn ? await signedInEcode(req) : (body.ecode ?? '').trim()
  if (!ecode) {
    return json({ error: signedIn ? 'Please sign in again.' : 'Enter your employee code.' }, 401)
  }

  const db = admin()

  try {
    /*
      Prove the sender address works, before it matters.

      A wrong From is rejected by the provider on every send, and the way
      you find out is that password resets stop working for the whole
      company — silently, since nobody reports an email they were not
      expecting. So the screen that sets it can also test it.

      The recipient is not a parameter. "Send a test anywhere" on an
      admin screen is a way to point the company's mail reputation at
      whoever you like; the database decides, and it only ever answers
      with the SW Admin's own address.
    */
    if (body.action === 'test') {
      const { data, error } = await db.rpc('otp_test_recipient', {
        p_caller: ecode,
        p_target: (body.target ?? '').trim() || null,
      })
      if (error) throw error
      const who = data as {
        ok: boolean; reason?: string; email?: string; name?: string; ecode?: string
      }

      if (!who.ok) {
        const said: Record<string, string> = {
          no_such_employee: 'No active employee has that code.',
          no_email_on_record: who.ecode
            ? `${who.name} (${who.ecode}) has no email address on their record.`
            : 'That record has no email address on it.',
          not_sw_admin: 'Only SW Admin can send a test.',
        }
        return json({ error: said[who.reason ?? ''] ?? 'Could not send a test.' }, 403)
      }

      await sendTest(db, who.email!, (who.name ?? '').split(' ')[0] || 'there')
      return json({
        ok: true,
        message: `Test sent to ${who.name} at ${who.email}. If it does not arrive, ` +
                 `the sender address is not verified with the mail provider.`,
      })
    }

    if (body.action === 'request') {
      const code = sixDigitCode()
      const { data, error } = await db.rpc('issue_password_otp', {
        p_ecode: ecode,
        p_email: (body.email ?? '').trim(),
        p_purpose: purpose,
        p_code: code,
      })
      if (error) throw error

      const result = data as {
        ok: boolean; reason?: string; email?: string; name?: string
      }

      if (result.ok) {
        await sendCode(db, result.email!, (result.name ?? '').split(' ')[0] || 'there', code, purpose)
      }

      // Truthful to somebody asking about their own account; the same
      // sentence to everybody else however it went.
      if (!result.ok && signedIn) {
        const said: Record<string, string> = {
          no_email_on_record:
            'There is no email address on your record yet. Ask HR to add your official email.',
          email_mismatch: 'That is not the email address on your record.',
          rate_limited: 'Too many codes requested. Try again in 15 minutes.',
        }
        return json({ error: said[result.reason ?? ''] ?? 'Could not send a code.' }, 400)
      }

      return json({ ok: true, message: signedIn ? 'Code sent to your email.' : NEUTRAL })
    }

    if (body.action === 'submit') {
      const password = body.password ?? ''
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400)
      }

      const { data, error } = await db.rpc('check_password_otp', {
        p_ecode: ecode,
        p_code: (body.code ?? '').trim(),
        p_purpose: purpose,
      })
      if (error) throw error

      const result = data as {
        ok: boolean; reason?: string; attempts_left?: number
        employee_id?: string; auth_user_id?: string
      }

      if (!result.ok) {
        const said: Record<string, string> = {
          wrong_code: result.attempts_left
            ? `That code is not right. ${result.attempts_left} attempt${result.attempts_left === 1 ? '' : 's'} left.`
            : 'That code is not right.',
          expired: 'That code has expired. Ask for a new one.',
          too_many_attempts: 'Too many wrong codes. Ask for a new one.',
          no_code_outstanding: 'No code is waiting. Ask for a new one.',
        }
        return json({ error: said[result.reason ?? ''] ?? 'That code is not right.' }, 400)
      }

      if (!result.auth_user_id) {
        return json({ error: 'This account has no login attached. Contact HR.' }, 400)
      }

      const { error: setErr } = await db.auth.admin.updateUserById(result.auth_user_id, { password })
      if (setErr) return json({ error: setErr.message }, 400)

      // They have just chosen a real one, so the first-login nag is done.
      await db.from('employees')
        .update({ must_change_password: false })
        .eq('id', result.employee_id!)

      return json({ ok: true, message: 'Password changed. Sign in with your new password.' })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    // Never the raw message: it can carry an address, a Resend response
    // or a Postgres detail line.
    console.error('password-otp', err)
    return json({ error: 'Something went wrong sending that. Try again shortly.' }, 500)
  }
})
