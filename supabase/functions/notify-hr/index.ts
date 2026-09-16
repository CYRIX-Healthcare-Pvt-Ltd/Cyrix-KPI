import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendMail, graphConfigured } from '../_shared/mail.ts'

/**
 * Tells a desk that something is waiting, and tells it again tomorrow.
 *
 * Two jobs, one function, because one function is one deploy and one set
 * of secrets:
 *
 *   { kind, id }    — something has just arrived. One email, once.
 *   { sweep: true } — a day's round-up of whatever is still waiting.
 *
 * Both desks are served. The software desk was deliberately silent when
 * this was written (0106) on the grounds that routing "I cannot sign in"
 * into HR's inbox helps nobody — but the answer to that is its own
 * address, not silence, and it has one. HR's mail copies whoever HR has
 * asked to be copied; the software desk has a single address and no CC.
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
 * The round-up uses the same ledger against the day it is for, so every
 * browser in the company may ask for it and the desk still gets one.
 *
 * Deploy:  supabase functions deploy notify-hr
 * Secrets: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM —
 *          see _shared/mail.ts. RESEND_API_KEY is the fallback while the
 *          switch to Graph settles.
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
type Desk = 'hr' | 'sw'

const BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://app.cyrix.in').replace(/\/+$/, '')

/** Where the thing is waiting. Records and revisions share one screen. */
const WHERE: Record<Kind, { path: string; screen: string }> = {
  support:  { path: '/kpi/admin/support',  screen: 'Support' },
  leaver:   { path: '/kpi/admin/requests', screen: 'Leavers' },
  record:   { path: '/kpi/deletions',      screen: 'Records' },
  revision: { path: '/kpi/deletions',      screen: 'Records' },
}

/** The software desk staffs one queue, on its own screen. */
const SW_SUPPORT = { path: '/kpi/admin/logins', screen: 'Support' }

const placeOf = (kind: Kind, desk: Desk) =>
  kind === 'support' && desk === 'sw' ? SW_SUPPORT : WHERE[kind]

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
  /** Whose desk it landed on. */
  desk: Desk
}

/**
 * Reads the source row and says what it is, in a sentence.
 *
 * Returns null when the row is not there. A software-desk ticket is no
 * longer one of those cases: it comes back with desk 'sw', and is sent
 * to the address that desk has.
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
    const desk: Desk = data.desk === 'software' ? 'sw' : 'hr'
    const who = await person(data.employee_id)
    return {
      who,
      desk,
      headline: `${who} has asked ${desk === 'sw' ? 'the software desk' : 'HR'} a question`,
      detail: data.employee_note ?? '',
    }
  }

  if (kind === 'leaver') {
    const { data } = await db.from('tm_removal_requests')
      .select('employee_id, reason, last_working_day').eq('id', id).maybeSingle()
    if (!data) return null
    const who = await person(data.employee_id)
    return {
      who,
      desk: 'hr',
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
      desk: 'hr',
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
    desk: 'hr',
    headline: `${who} wants their KPI reopened`,
    detail: [data.financial_year ? `Year: ${data.financial_year}` : '', data.reason]
      .filter(Boolean).join('\n'),
  }
}

/**
 * Who hears about it: the admin who staffs that desk, and — for HR —
 * whoever HR Admin has asked to be copied.
 */
async function recipients(
  db: ReturnType<typeof admin>, desk: Desk,
): Promise<{ to: string[]; cc: string[] }> {
  // Two plain reads rather than an embedded join. A join here would be
  // one row per user_roles match, so a second hr_admin row — or a second
  // holder of the role — turns maybeSingle() into an error and nobody
  // gets told anything. Two queries cannot be ambiguous.
  const { data: role } = await db.from('user_roles')
    .select('employee_id').eq('role', desk === 'sw' ? 'sw_admin' : 'hr_admin')
    .limit(1).maybeSingle()

  let to = ''
  if (role?.employee_id) {
    const { data: emp } = await db.from('employees')
      .select('work_email').eq('id', role.employee_id).maybeSingle()
    to = (emp?.work_email ?? '').trim()
  }

  // The copy list is HR's own setting. The software desk has one address
  // and no list to keep, which is why nothing is read for it here.
  if (desk === 'sw') return { to: to ? [to] : [], cc: [] }

  const { data: setting } = await db.from('app_settings')
    .select('value').eq('key', 'hr_notify_cc').maybeSingle()
  const raw = setting?.value
  const cc = Array.isArray(raw) ? raw.filter(a => typeof a === 'string' && a.includes('@')) : []

  return { to: to ? [to] : [], cc: cc.filter(a => a !== to) }
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const button = (link: string, label: string) =>
  `<p style="margin:24px 0"><a href="${link}" ` +
  `style="background:#ce2434;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">` +
  `${escape(label)}</a></p>`

const FOOTER_TEXT = 'This is an automatic note from Cyrix. Nobody needs to reply to it.\n'
const FOOTER_HTML =
  `<p style="color:#8792a2;font-size:13px">An automatic note from Cyrix. Nobody needs to reply to it.</p>`

const wrap = (inner: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">${inner}</div>`

/* ====================================================================
   The day's round-up
   ==================================================================== */

/** Whole days waited, the same arithmetic the screens do (src/lib/tat.ts). */
const daysWaiting = (since: string): number =>
  Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000))

/**
 * The working day this is, in Indian time.
 *
 * The round-up is claimed against a day, so which day it is has to be
 * the day the people reading it are living in. A UTC date rolls over at
 * half past five in the morning there, which would let a second round-up
 * out before anybody had opened the first.
 */
const istDay = (now = new Date()): string =>
  new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)

/** The hour in Indian time, 0–23. Nothing is chased in the middle of the night. */
const istHour = (now = new Date()): number =>
  Number(new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(11, 13))

/**
 * A uuid for "this desk, this day", so the ledger's unique key does the
 * work of a schedule: whoever asks first sends it, everybody after is
 * told it has already gone.
 */
async function dayKey(desk: Desk, day: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`digest:${desk}:${day}`)),
  )
  const hex = [...bytes.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16),
          '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-')
}

interface Waiting {
  kind: Kind
  source_id: string
  who: string
  headline: string
  detail: string
  waiting_since: string
}

/**
 * One desk's round-up.
 *
 * Only what has been waiting more than a day: a question raised this
 * morning is not something to be chased about this evening, and a
 * reminder that arrives for everything is a reminder nobody reads.
 */
async function sweepDesk(
  db: ReturnType<typeof admin>, desk: Desk,
): Promise<{ desk: Desk; sent: boolean; reason?: string; items?: number; oldest?: number }> {
  const { data, error } = await db.rpc('pending_admin_work', { p_desk: desk })
  if (error) return { desk, sent: false, reason: 'could not read the queue' }

  const all = (data ?? []) as Waiting[]
  const late = all.filter(w => daysWaiting(w.waiting_since) >= 1)
  if (late.length === 0) return { desk, sent: false, reason: 'nothing has been waiting a day' }

  const day = istDay()
  const kind = desk === 'sw' ? 'digest_sw' : 'digest_hr'
  const { data: claim, error: claimErr } = await db.from('admin_notifications')
    .insert({ kind, source_id: await dayKey(desk, day) })
    .select('id')
    .maybeSingle()
  if (claimErr || !claim) {
    return { desk, sent: false, reason: claimErr?.code === '23505' ? 'already sent today' : 'could not claim' }
  }

  const { to, cc } = await recipients(db, desk)
  if (to.length === 0) {
    await db.from('admin_notifications')
      .update({ error: `${desk} admin has no work_email on their record` }).eq('id', claim.id)
    return { desk, sent: false, reason: 'no recipient' }
  }

  const oldest = Math.max(...late.map(w => daysWaiting(w.waiting_since)))
  const deskName = desk === 'sw' ? 'the software desk' : 'HR'
  const headline =
    `${late.length} thing${late.length === 1 ? ' is' : 's are'} waiting on ${deskName}` +
    ` — the oldest ${oldest} day${oldest === 1 ? '' : 's'}`

  // Grouped by screen, because that is how they get dealt with: one trip
  // to Support, one to Leavers, rather than eight separate errands.
  const byScreen = new Map<string, { link: string; rows: Waiting[] }>()
  for (const w of late) {
    const place = placeOf(w.kind, desk)
    const entry = byScreen.get(place.screen) ?? { link: `${BASE}${place.path}`, rows: [] }
    entry.rows.push(w)
    byScreen.set(place.screen, entry)
  }

  const line = (w: Waiting) => {
    const d = daysWaiting(w.waiting_since)
    return `${w.headline} — waiting ${d} day${d === 1 ? '' : 's'}`
  }

  const text =
    `${headline}.\n\n` +
    [...byScreen.entries()].map(([screen, e]) =>
      `${screen}\n` + e.rows.map(w => `  · ${line(w)}`).join('\n') + `\n  ${e.link}\n`,
    ).join('\n') +
    `\nThis note goes out once a day while anything is still waiting.\n\n` +
    FOOTER_TEXT

  const html = wrap(
    `<p style="color:#0b0d10;font-size:16px;font-weight:600">${escape(headline)}</p>` +
    [...byScreen.entries()].map(([screen, e]) =>
      `<p style="color:#0b0d10;font-size:13px;font-weight:600;text-transform:uppercase;` +
      `letter-spacing:.04em;margin:18px 0 6px">${escape(screen)}</p>` +
      `<ul style="color:#39424e;padding-left:18px;margin:0">` +
      e.rows.map(w => `<li style="margin:4px 0">${escape(line(w))}</li>`).join('') +
      `</ul>` + button(e.link, `Open ${screen}`),
    ).join('') +
    `<p style="color:#8792a2;font-size:13px">This note goes out once a day while ` +
    `anything is still waiting.</p>` + FOOTER_HTML,
  )

  try {
    await sendMail(db, { to, cc, subject: headline, text, html })
    await db.from('admin_notifications')
      .update({ sent_at: new Date().toISOString(), recipients: [...to, ...cc] })
      .eq('id', claim.id)
    return { desk, sent: true, items: late.length, oldest }
  } catch (err) {
    await db.from('admin_notifications')
      .update({ error: String(err).slice(0, 500) }).eq('id', claim.id)
    return { desk, sent: false, reason: 'send failed' }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Signed in, and that is the whole check. Nothing here is told to the
  // caller, and the claim below means the worst a signed-in employee can
  // do with a guessed id is send HR one email about a real row.
  if (!callerFromToken(req)) return json({ ok: false }, 401)

  let body: { kind?: string; id?: string; sweep?: boolean; force?: boolean }
  try { body = await req.json() } catch { return json({ ok: false }, 400) }

  const db = admin()

  if (!graphConfigured() && !Deno.env.get('RESEND_API_KEY')) {
    return json({ ok: true, sent: false, reason: 'not configured' })
  }

  /* ---- the day's round-up ------------------------------------------ */
  if (body.sweep) {
    // Between nine in the morning and eight at night, Indian time. A
    // reminder that lands at three in the morning is read as a fault in
    // the software rather than a queue that needs attention. `force`
    // exists for the first run and for a check by hand.
    const hour = istHour()
    if (!body.force && (hour < 9 || hour >= 20)) {
      return json({ ok: true, sent: false, reason: 'outside the hours it is sent in' })
    }
    const results = await Promise.all(
      (['hr', 'sw'] as Desk[]).map(desk => sweepDesk(db, desk)),
    )
    return json({ ok: true, results })
  }

  /* ---- something has just arrived ---------------------------------- */
  const kind = body.kind as Kind
  const id = (body.id ?? '').trim()
  if (!WHERE[kind] || !/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false }, 400)

  const summary = await summarise(db, kind, id)
  // No such row. "Nothing to do" rather than an error: the row may have
  // been withdrawn between the click and this call.
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

  const { to, cc } = await recipients(db, summary.desk)
  if (to.length === 0) {
    await db.from('admin_notifications')
      .update({ error: `${summary.desk} admin has no work_email on their record` })
      .eq('id', claim.id)
    return json({ ok: true, sent: false, reason: 'no recipient' })
  }

  const where = placeOf(kind, summary.desk)
  const link = `${BASE}${where.path}`

  const text =
    `${summary.headline}.\n\n` +
    (summary.detail ? `${summary.detail}\n\n` : '') +
    `It is waiting on the ${where.screen} screen:\n${link}\n\n` +
    FOOTER_TEXT

  const html = wrap(
    `<p style="color:#0b0d10;font-size:16px;font-weight:600">${escape(summary.headline)}</p>` +
    (summary.detail
      ? `<p style="color:#39424e;white-space:pre-wrap;border-left:3px solid #dfe3e8;padding-left:12px">${escape(summary.detail)}</p>`
      : '') +
    button(link, `Open ${where.screen}`) + FOOTER_HTML,
  )

  try {
    const sent = await sendMail(db, {
      to, cc, subject: summary.headline, text, html,
    })
    await db.from('admin_notifications')
      .update({ sent_at: new Date().toISOString(), recipients: [...to, ...cc] })
      .eq('id', claim.id)
    return json({ ok: true, sent: true, via: sent.via })
  } catch (err) {
    await db.from('admin_notifications')
      .update({ error: String(err).slice(0, 500) }).eq('id', claim.id)
    // Still ok: the caller's action succeeded and this is not their problem.
    return json({ ok: true, sent: false, reason: 'send failed' })
  }
})
