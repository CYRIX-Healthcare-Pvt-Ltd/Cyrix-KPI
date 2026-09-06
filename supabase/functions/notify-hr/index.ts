import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Tells HR that something is waiting, and where it is waiting.
 *
 * Four queues carry a badge nobody sees unless they are already signed
 * in, and two of them are a person waiting on HR: a leaver who is still
 * on the payroll screen, a month somebody sent in by mistake. Over a
 * weekend that wait is measured in days for want of one email.
 *
 * WHY THE BROWSER ASKS FOR THIS
 *
 * There is no pg_net and no pg_cron on this project, so the database
 * cannot make an HTTP request and nothing can drain a queue on a timer.
 * The only path that exists is the one password codes already take. That
 * makes the send best-effort by construction, which is why:
 *
 *   - the caller is told nothing useful and never blocked. Raising a
 *     ticket must not fail because a mail provider is having a morning.
 *   - the claim in admin_notifications is a unique key, so a retry, a
 *     double click or two tabs produce one email rather than three.
 *   - a failure is written down rather than thrown away, so "did HR ever
 *     get told?" has an answer that is not a shrug.
 *
 * The software desk deliberately sends nothing. SW Admin watches that
 * queue, and routing it here would put every "I cannot sign in" into
 * HR's inbox.
 *
 * Deploy:  supabase functions deploy notify-hr
 * Secrets: RESEND_API_KEY (shared with password-otp)
 *          APP_BASE_URL, optional — defaults to the live portal.
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

/** The same reading as password-otp: the gateway has already verified it. */
function callerFromToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub?: string; role?: string; exp?: number }
    if (claims.role !== 'authenticated' || !claims.sub) return null
    if (claims.exp && claims.exp * 1000 < Date.now()) return null
    return claims.sub
  } catch {
    return null
  }
}

type Kind = 'support' | 'leaver' | 'record' | 'revision'

const BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://app.cyrix.in').replace(/\/+$/, '')

/** Where the thing is waiting. Records and revisions share one screen. */
const WHERE: Record<Kind, { path: string; screen: string }> = {
  support:  { path: '/kpi/admin/support',  screen: 'Support' },
  leaver:   { path: '/kpi/admin/requests', screen: 'Leavers' },
  record:   { path: '/kpi/deletions',      screen: 'Records' },
  revision: { path: '/kpi/deletions',      screen: 'Records' },
}

/**
 * A date column, as something a person would write.
 *
 * These arrive as plain dates over PostgREST but as full timestamps
 * through other drivers, and "Last working day:
 * 2026-08-03T18:30:00.000Z" in an email to HR is the kind of detail that
 * makes software look like it is talking to itself. Takes the date half
 * and nothing else.
 */
const onDay = (v: unknown): string => {
  const s = String(v ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/** "2026-07-01" -> "Jul 2026". The month is the useful half here. */
const asMonth = (v: unknown): string => {
  const day = onDay(v)
  if (!day) return ''
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`
}

interface Summary {
  /** One line for the subject. */
  headline: string
  /** Whatever the person actually wrote. */
  detail: string
  who: string
}

/**
 * Reads the source row and says what it is, in a sentence.
 *
 * Returns null when the row is not there, or is a software-desk ticket,
 * which is the one case where being asked to send is not an error.
 */
async function summarise(
  db: ReturnType<typeof admin>, kind: Kind, id: string,
): Promise<Summary | null> {
  const person = async (employeeId: string | null | undefined) => {
    if (!employeeId) return 'Somebody'
    const { data } = await db.from('employees')
      .select('full_name, ecode').eq('id', employeeId).maybeSingle()
    return data ? `${data.full_name} (${data.ecode})` : 'Somebody'
  }

  if (kind === 'support') {
    const { data } = await db.from('support_tickets')
      .select('employee_id, desk, employee_note').eq('id', id).maybeSingle()
    if (!data) return null
    // The whole reason this branch can return null on a real row.
    if (data.desk !== 'hr') return null
    const who = await person(data.employee_id)
    return { who, headline: `${who} has asked HR a question`, detail: data.employee_note ?? '' }
  }

  if (kind === 'leaver') {
    const { data } = await db.from('tm_removal_requests')
      .select('employee_id, reason, last_working_day').eq('id', id).maybeSingle()
    if (!data) return null
    const who = await person(data.employee_id)
    return {
      who,
      headline: `${who} has been flagged as having left`,
      detail: [data.reason, onDay(data.last_working_day) ? `Last working day: ${onDay(data.last_working_day)}` : '']
        .filter(Boolean).join('\n'),
    }
  }

  if (kind === 'record') {
    const { data } = await db.from('record_deletion_requests')
      .select('employee_id, period_month, reason, status').eq('id', id).maybeSingle()
    if (!data) return null
    const who = await person(data.employee_id)
    return {
      who,
      headline: `${who} wants a month removed`,
      detail: [asMonth(data.period_month) ? `Month: ${asMonth(data.period_month)}` : '', data.reason]
        .filter(Boolean).join('\n'),
    }
  }

  const { data } = await db.from('kpi_revision_requests')
    .select('employee_id, financial_year, reason').eq('id', id).maybeSingle()
  if (!data) return null
  const who = await person(data.employee_id)
  return {
    who,
    headline: `${who} wants their KPI reopened`,
    detail: [data.financial_year ? `Year: ${data.financial_year}` : '', data.reason]
      .filter(Boolean).join('\n'),
  }
}

/** HR Admin, and whoever HR Admin has asked to be copied. */
async function recipients(
  db: ReturnType<typeof admin>,
): Promise<{ to: string[]; cc: string[] }> {
  // Two plain reads rather than an embedded join. A join here would be
  // one row per user_roles match, so a second hr_admin row — or a second
  // holder of the role — turns maybeSingle() into an error and nobody
  // gets told anything. Two queries cannot be ambiguous.
  const { data: role } = await db.from('user_roles')
    .select('employee_id').eq('role', 'hr_admin').limit(1).maybeSingle()

  let to = ''
  if (role?.employee_id) {
    const { data: emp } = await db.from('employees')
      .select('work_email').eq('id', role.employee_id).maybeSingle()
    to = (emp?.work_email ?? '').trim()
  }
  const { data: setting } = await db.from('app_settings')
    .select('value').eq('key', 'hr_notify_cc').maybeSingle()
  const raw = setting?.value
  const cc = Array.isArray(raw) ? raw.filter(a => typeof a === 'string' && a.includes('@')) : []

  return { to: to ? [to] : [], cc: cc.filter(a => a !== to) }
}

async function senderAddress(db: ReturnType<typeof admin>): Promise<string> {
  try {
    const { data } = await db.rpc('otp_sender')
    if (typeof data === 'string' && data.includes('@')) return data
  } catch { /* fall through */ }
  return Deno.env.get('OTP_FROM') ?? 'Cyrix <no-reply@updates.cyrix.in>'
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Signed in, and that is the whole check. Nothing here is told to the
  // caller, and the claim below means the worst a signed-in employee can
  // do with a guessed id is send HR one email about a real row.
  if (!callerFromToken(req)) return json({ ok: false }, 401)

  let body: { kind?: string; id?: string }
  try { body = await req.json() } catch { return json({ ok: false }, 400) }

  const kind = body.kind as Kind
  const id = (body.id ?? '').trim()
  if (!WHERE[kind] || !/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false }, 400)

  const db = admin()

  const summary = await summarise(db, kind, id)
  // No such row, or a software-desk ticket. Both are "nothing to do".
  if (!summary) return json({ ok: true, sent: false, reason: 'nothing to send' })

  /*
    Claiming the row IS the lock.

    Inserted before the send rather than after it, because the failure
    that matters is two emails, not zero: a lost send leaves a row with
    no sent_at that somebody can see and act on, while a double send is
    already in an inbox and cannot be recalled.
  */
  const { data: claim, error: claimErr } = await db.from('admin_notifications')
    .insert({ kind, source_id: id })
    .select('id')
    .maybeSingle()
  if (claimErr) {
    // 23505 is the unique key doing exactly its job: somebody — a retry,
    // a second tab — already claimed this one. Anything else is a real
    // fault, and must not be mistaken for "already done" or the email is
    // silently never sent again.
    const already = claimErr.code === '23505'
    return json({ ok: true, sent: false, reason: already ? 'already sent' : 'could not claim' })
  }
  if (!claim) return json({ ok: true, sent: false, reason: 'already sent' })

  const { to, cc } = await recipients(db)
  if (to.length === 0) {
    await db.from('admin_notifications')
      .update({ error: 'HR Admin has no work_email on their record' })
      .eq('id', claim.id)
    return json({ ok: true, sent: false, reason: 'no recipient' })
  }

  const where = WHERE[kind]
  const link = `${BASE}${where.path}`
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    await db.from('admin_notifications')
      .update({ error: 'RESEND_API_KEY is not set' }).eq('id', claim.id)
    return json({ ok: true, sent: false, reason: 'not configured' })
  }

  const text =
    `${summary.headline}.\n\n` +
    (summary.detail ? `${summary.detail}\n\n` : '') +
    `It is waiting on the ${where.screen} screen:\n${link}\n\n` +
    `This is an automatic note from Cyrix. Nobody needs to reply to it.\n`

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">` +
    `<p style="color:#0b0d10;font-size:16px;font-weight:600">${escape(summary.headline)}</p>` +
    (summary.detail
      ? `<p style="color:#39424e;white-space:pre-wrap;border-left:3px solid #dfe3e8;padding-left:12px">${escape(summary.detail)}</p>`
      : '') +
    `<p style="margin:24px 0"><a href="${link}" ` +
    `style="background:#ce2434;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">` +
    `Open ${escape(where.screen)}</a></p>` +
    `<p style="color:#8792a2;font-size:13px">An automatic note from Cyrix. Nobody needs to reply to it.</p></div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: await senderAddress(db),
        to,
        ...(cc.length ? { cc } : {}),
        subject: summary.headline,
        text,
        html,
      }),
    })
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    await db.from('admin_notifications')
      .update({ sent_at: new Date().toISOString(), recipients: [...to, ...cc] })
      .eq('id', claim.id)
    return json({ ok: true, sent: true })
  } catch (err) {
    await db.from('admin_notifications')
      .update({ error: String(err).slice(0, 500) }).eq('id', claim.id)
    // Still ok: the caller's action succeeded and this is not their problem.
    return json({ ok: true, sent: false, reason: 'send failed' })
  }
})
