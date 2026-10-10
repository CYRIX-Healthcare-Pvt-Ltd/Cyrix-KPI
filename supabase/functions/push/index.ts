import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

/**
 * Notifications on the phone and the desktop (0154).
 *
 *   { action: 'send', target, title, body }   HR Admin or SW Admin, signed in:
 *       a message to everyone, one person, a manager and everyone under
 *       them, a function or a department.
 *   { action: 'bell' }        every 5 minutes, from pg_cron: whatever has
 *       come into somebody's bell since it was last looked at; and Revive
 *       Lab tickets newly waiting on them, or raised in their team (0160).
 *   { action: 'reminders' }   09:30 IST, from pg_cron: on the 1st, last month
 *       is open (0155); and the last-day reminder, from three days before,
 *       once a day, the same message.
 *
 * The timer calls carry x-push-key (the vault's push_reminder_key, the same
 * as this function's PUSH_REMINDER_KEY). A send carries the person's own
 * sign-in, and the database decides whether they may (push_audience).
 *
 * A device that has gone (404 / 410 from its push service) is removed.
 *
 * Deploy:  supabase functions deploy push --no-verify-jwt
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_REMINDER_KEY
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const admin = () => createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

webpush.setVapidDetails('https://app.cyrix.in', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)

type Payload = { title: string; body: string; url: string; tag?: string }
type Tally = { people: number; devices: number; delivered: number; failed: number }

/** Every device of these people, sent the same payload, twenty at a time. */
async function deliver(db: ReturnType<typeof admin>, ids: string[], p: Payload): Promise<Tally> {
  const tally: Tally = { people: ids.length, devices: 0, delivered: 0, failed: 0 }
  const subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth').in('employee_id', ids.slice(i, i + 300))
    if (error) throw error
    subs.push(...(data ?? []))
  }
  tally.devices = subs.length
  const gone: string[] = [], ok: string[] = []
  const body = JSON.stringify(p)
  for (let i = 0; i < subs.length; i += 20) {
    await Promise.all(subs.slice(i, i + 20).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
          { TTL: 24 * 3600, urgency: 'normal', topic: p.tag?.slice(0, 32) })
        ok.push(s.id); tally.delivered++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) gone.push(s.id)
        tally.failed++
      }
    }))
  }
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone)
  if (ok.length) await db.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), failures: 0 }).in('id', ok)
  return tally
}

/** The bell's own words (src/components/Notifications.tsx). If one changes, change both. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const BELL: Record<string, { title: (n: number) => string; body: string; href: string }> = {
  approvals: { title: n => `${plural(n, 'KPI')} waiting for your approval`, body: 'Nobody can start a monthly assessment until their KPI is approved.', href: '/approvals' },
  scoring: { title: n => `${plural(n, 'month')} waiting for your score`, body: 'Your team have sent theirs in. The manager score is yours to enter.', href: '/team' },
  score_query: { title: n => `${plural(n, 'query', 'queries')} about your scoring`, body: 'A team member has asked about rows you scored. The month stays open until you reply.', href: '/queries' },
  records_manager: { title: n => `${plural(n, 'record request')} for you`, body: 'A deletion or a KPI revision needs your decision before it reaches HR.', href: '/deletions' },
  records_hr: { title: n => `${plural(n, 'record request')} at HR`, body: 'The reporting manager has approved these. They are waiting on you.', href: '/deletions' },
  leavers: { title: n => `${plural(n, 'leaver')} to process`, body: 'A manager has flagged someone as having left.', href: '/admin/requests' },
  kpi_rejected: { title: () => 'Your manager sent your KPI back', body: 'Make the changes they asked for, then submit it again.', href: '/my-kpi' },
  month_returned: { title: n => `${plural(n, 'month')} sent back to you`, body: 'Your manager has asked for a correction before scoring it.', href: '/history' },
  kpi_approved: { title: () => 'Your KPI has been approved', body: 'Monthly assessments are open — start with the months already gone.', href: '/history' },
  month_scored: { title: n => `${plural(n, 'month')} scored`, body: 'Your manager has finished. The result is on your record.', href: '/history' },
  score_query_answered: { title: n => `${plural(n, 'query', 'queries')} answered`, body: 'Your manager has replied to what you asked about.', href: '/history' },
  support_answered: { title: n => `${plural(n, 'request')} answered`, body: 'HR or Software has replied to what you asked.', href: '/support' },
  template_pushed: { title: n => `${plural(n, 'KPI template')} changed below you`, body: 'A manager in your line changed a template and applied it to the people on it.', href: '/team/templates' },
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let input: Record<string, unknown>
  try { input = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const db = admin()

  // Switched off by SW Admin (0161): nothing reaches a phone or desktop.
  // The app itself carries on — a message still lands in the bell (the
  // user: "when disabled means only device notification, not in app").
  const { data: on } = await db.rpc('push_is_enabled')
  const devicesOn = on !== false
  if (!devicesOn && input.action !== 'send' && input.action !== 'digest') return json({ off: true })

  // ---- the timers ----
  if (input.action === 'bell' || input.action === 'reminders') {
    if (req.headers.get('x-push-key') !== Deno.env.get('PUSH_REMINDER_KEY')) return json({ error: 'Not allowed' }, 403)

    if (input.action === 'bell') {
      const { data, error } = await db.rpc('push_bell_due')
      if (error) return json({ error: error.message }, 500)
      const total: Tally = { people: 0, devices: 0, delivered: 0, failed: 0 }
      for (const r of (data ?? []) as Array<{ employee_id: string; kind: string; n: number; detail: string | null }>) {
        // Revive Lab (0160): the tickets themselves, in the words of its Waiting on you.
        const p: Payload | null = r.kind === 'revive'
          ? { title: `${plural(r.n, 'Revive Lab ticket')} waiting for you`, body: r.detail ?? '', url: '/revive/', tag: 'bell-revive' }
          : r.kind === 'revive_team'
          ? { title: 'Revive Lab · your team', body: r.detail ?? `${plural(r.n, 'ticket')} raised in your team`, url: '/revive/', tag: 'bell-revive-team' }
          : BELL[r.kind] ? { title: BELL[r.kind].title(r.n), body: BELL[r.kind].body, url: '/kpi' + BELL[r.kind].href, tag: 'bell-' + r.kind } : null
        if (!p) continue
        const t = await deliver(db, [r.employee_id], p)
        total.people += t.people; total.devices += t.devices; total.delivered += t.delivered; total.failed += t.failed
      }
      // A Cyrix Digest meeting about to start (0163): everybody, 15 minutes before, once.
      const { data: soon } = await db.rpc('digest_meetings_due')
      for (const m of (soon ?? []) as Array<{ id: string; title: string; meet_at: string; meet_place: string | null }>) {
        const at = new Date(m.meet_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
        const { data: claim, error: dup } = await db.from('push_messages').insert({
          kind: 'reminder', title: 'Starting soon · ' + m.title, body: `At ${at}${m.meet_place ? ' · ' + m.meet_place : ''}. Join from Cyrix Digest.`,
          url: '/', target: { kind: 'reminder', side: 'meeting' }, dedupe_key: 'digest-reminder:' + m.id,
        }).select('id').single()
        if (dup || !claim) continue
        const { data: all } = await db.from('employees').select('id').eq('is_active', true)
        const t = await deliver(db, ((all ?? []) as Array<{ id: string }>).map(r => r.id),
          { title: 'Starting soon · ' + m.title, body: `At ${at}${m.meet_place ? ' · ' + m.meet_place : ''}. Join from Cyrix Digest.`, url: '/', tag: 'digest-' + m.id })
        await db.from('push_messages').update(t).eq('id', claim.id)
      }
      return json(total)
    }

    const { data, error } = await db.rpc('push_reminders_due')
    if (error) return json({ error: error.message }, 500)
    const rows = (data ?? []) as Array<{ employee_id: string; side: string; title: string; body: string; url: string }>
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
    const out: Record<string, Tally | 'already sent'> = {}
    for (const side of ['open', 'tm', 'manager']) {
      const mine = rows.filter(r => r.side === side)
      if (!mine.length) continue
      // Once a day, whoever calls: the ledger row is the claim.
      const { data: claim, error: dup } = await db.from('push_messages').insert({
        kind: 'reminder', title: mine[0].title, body: mine[0].body, url: mine[0].url,
        target: { kind: 'reminder', side }, dedupe_key: `reminder:${side}:${today}`,
      }).select('id').single()
      if (dup) { out[side] = 'already sent'; continue }
      // Same words for everyone on a side; the link is per month and the same too.
      const t = await deliver(db, mine.map(r => r.employee_id), { title: mine[0].title, body: mine[0].body, url: mine[0].url, tag: 'reminder-' + side })
      await db.from('push_messages').update(t).eq('id', claim!.id)
      out[side] = t
    }
    return json(out)
  }

  // ---- a Cyrix Digest post, from HR or IT (0163): into everybody's bell, and their devices ----
  if (input.action === 'digest') {
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: desk } = await user.rpc('digest_can_post')
    if (!desk) return json({ error: 'Only HR Admin or IT Admin can post to Cyrix Digest' }, 403)
    const { data: post } = await db.from('digest_posts').select('*').eq('id', String(input.post_id ?? '')).is('deleted_at', null).maybeSingle()
    if (!post) return json({ error: 'That post is not there' }, 404)
    const when = post.kind === 'meeting'
      ? new Date(post.meet_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
      : ''
    const KIND: Record<string, string> = { meeting: 'Meeting', poll: 'Poll', announcement: 'Announcement', alert: 'Alert', notice: 'Notice', vacancy: 'Vacancy' }
    const title = (KIND[post.kind] ?? 'Cyrix Digest') + ' · ' + post.title
    const body = post.kind === 'meeting'
      ? `${when}${post.meet_place ? ' · ' + post.meet_place : ''}`
      : post.kind === 'poll' ? 'Have your say in Cyrix Digest.'
      : String(post.body ?? '').replace(/\s+/g, ' ').slice(0, 140)
    const { data: me } = await user.rpc('current_employee_id')
    const { data: all } = await db.from('employees').select('id').eq('is_active', true)
    const people = ((all ?? []) as Array<{ id: string }>).map(r => r.id)
    const { data: row } = await db.from('push_messages').insert({
      kind: 'manual', title, body, url: '/', target: { kind: 'digest', post: post.id }, sent_by: me ?? null, sent_as: desk,
    }).select('id').single()
    if (row) {
      for (let i = 0; i < people.length; i += 500) {
        await db.from('push_inbox').insert(people.slice(i, i + 500).map(employee_id => ({ message_id: row.id, employee_id })))
      }
    }
    const t = devicesOn ? await deliver(db, people, { title, body, url: '/', tag: 'digest-' + post.id }) : { people: people.length, devices: 0, delivered: 0, failed: 0 }
    if (row) await db.from('push_messages').update(t).eq('id', row.id)
    return json(t)
  }

  // ---- a message from HR or SW Admin ----
  if (input.action === 'send') {
    const auth = req.headers.get('Authorization') ?? ''
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false }, global: { headers: { Authorization: auth } },
    })
    const title = String(input.title ?? '').trim().slice(0, 80) || 'Cyrix'
    const body = String(input.body ?? '').trim().slice(0, 400)
    if (!body) return json({ error: 'Type the message first' }, 400)
    // Sent as HR or as SW Admin (0159): only that desk sees it afterwards.
    const as = input.as === 'sw' ? 'sw' : 'hr'
    const { data: ok } = await user.rpc('push_desk_ok', { p_as: as })
    if (!ok) return json({ error: as === 'sw' ? 'Only SW Admin can send from here' : 'Only HR Admin can send from here' }, 403)
    const { data: ids, error } = await user.rpc('push_audience', { p_target: input.target })
    if (error) return json({ error: error.message }, 403)
    const { data: me } = await user.rpc('current_employee_id')
    const people = ((ids ?? []) as Array<{ employee_id: string }>).map(r => r.employee_id)
    const { data: row } = await db.from('push_messages').insert({
      kind: 'manual', title, body, url: '/', target: input.target, sent_by: me ?? null, sent_as: as,
    }).select('id').single()
    // Into everybody's bell first (0158), devices or not.
    if (row) {
      for (let i = 0; i < people.length; i += 500) {
        await db.from('push_inbox').insert(people.slice(i, i + 500).map(employee_id => ({ message_id: row.id, employee_id })))
      }
    }
    const t = devicesOn
      ? await deliver(db, people, { title, body, url: '/kpi/', tag: 'msg-' + (row?.id ?? '') })
      : { people: people.length, devices: 0, delivered: 0, failed: 0 }
    if (row) await db.from('push_messages').update(t).eq('id', row.id)
    return json(t)
  }

  return json({ error: 'Unknown action' }, 400)
})
