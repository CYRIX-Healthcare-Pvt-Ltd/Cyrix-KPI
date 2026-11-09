import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendMail } from '../_shared/mail.ts'
import { recipients, words, type AdvanceRow } from './words.ts'
import { vehicleWords, type VehicleRow } from './vehicle.ts'
import { managerWords, type ManagerRow } from './manager.ts'
import { claimWords, claimsWords, depWords, copiesTo, type ClaimRow, type DepRow } from './more.ts'

/**
 * Travel Expense's mail: an expense advance the Travel Desk has approved, to the person with copies to their
 * reporting manager and the Travel Desk (Travel te_0067; the user, 24 Oct). The words are in words.ts.
 * Also an out-of-policy vehicle approved by the Travel Desk or removed by the manager (Travel te_0097), words in vehicle.ts,
 * and an advance the reporting manager approved, to the Travel Desk (Travel te_0128), words in manager.ts.
 *
 * Called by the approval itself (pg_net) and by pg_cron every five minutes, with the push key. Each call claims the
 * advances given and not mailed — claimed first, so each goes once even if two calls meet — and sends them two
 * seconds apart (Microsoft 365 takes about 30 a minute from one mailbox). A send that fails is written on the
 * advance (mail_error), not tried again.
 *
 * Deploy:  supabase functions deploy travel-mail --no-verify-jwt
 * Secrets: PUSH_REMINDER_KEY (as push), and the mail ones in _shared/mail.ts.
 */

const APP = Deno.env.get('APP_BASE_URL') ?? 'https://app.cyrix.in'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (req.headers.get('x-push-key') !== Deno.env.get('PUSH_REMINDER_KEY')) return json({ error: 'Not allowed' }, 403)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('te_advance_mail_claim', { p_limit: 20 })
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as AdvanceRow[]
  let sent = 0, failed = 0, noAddress = 0
  for (const [i, r] of rows.entries()) {
    const { to, cc } = recipients(r)
    if (!to.length) { noAddress++; await db.rpc('te_advance_mail_failed', { p_id: r.id, p_error: 'No work email for the person, the manager or the Travel Desk' }); continue }
    try {
      await sendMail(db as never, { to, cc, ...words(r, APP) })
      sent++
    } catch (e) {
      failed++
      await db.rpc('te_advance_mail_failed', { p_id: r.id, p_error: (e as Error).message })
    }
    if (i < rows.length - 1) await new Promise(res => setTimeout(res, 2000))
  }
  // Out-of-policy vehicles (te_0097): the same recipients — the person, copies to the manager and the Travel Desk.
  const { data: vdata, error: verr } = await db.rpc('te_va_mail_claim', { p_limit: 20 })
  if (verr) return json({ error: verr.message, claimed: rows.length, sent, failed, noAddress }, 500)
  const vrows = (vdata ?? []) as VehicleRow[]
  for (const [i, r] of vrows.entries()) {
    const { to, cc } = recipients(r)
    if (!to.length) { noAddress++; await db.rpc('te_va_mail_failed', { p_id: r.id, p_error: 'No work email for the person, the manager or the Travel Desk' }); continue }
    if (i > 0 || rows.length) await new Promise(res => setTimeout(res, 2000))
    try {
      await sendMail(db as never, { to, cc, ...vehicleWords(r, APP) })
      sent++
    } catch (e) {
      failed++
      await db.rpc('te_va_mail_failed', { p_id: r.id, p_error: (e as Error).message })
    }
  }
  // An advance the manager approved (te_0128): to the Travel Desk alone. Kept last, so a database without it yet
  // still sends the rest.
  const { data: mdata, error: merr } = await db.rpc('te_advance_mgr_mail_claim', { p_limit: 20 })
  const mrows = merr ? [] : (mdata ?? []) as ManagerRow[]
  for (const [i, r] of mrows.entries()) {
    const to = [...new Set((r.desk_emails ?? []).map(x => x.trim().toLowerCase()).filter(Boolean))]
    if (!to.length) { noAddress++; await db.rpc('te_advance_mgr_mail_failed', { p_id: r.id, p_error: 'No work email for the Travel Desk' }); continue }
    if (i > 0 || rows.length || vrows.length) await new Promise(res => setTimeout(res, 2000))
    try {
      await sendMail(db as never, { to, cc: [], ...managerWords(r, APP) })
      sent++
    } catch (e) {
      failed++
      await db.rpc('te_advance_mgr_mail_failed', { p_id: r.id, p_error: (e as Error).message })
    }
  }
  // A claim the Travel Desk approved, and a deputation the manager approved (te_0132): to the person, copies to the
  // manager, the Travel Desk and the people SW Admin ticked. A database without them yet sends the rest.
  let more = 0
  // A person's claims come together (te_0138) and go as one mail; one claim keeps its own mail.
  type Group = { ids: string[]; first: ClaimRow | DepRow; words: () => { subject: string; text: string; html: string } }
  const kinds: Array<{ claim: string; failed: string; groups: (rows: unknown[]) => Group[] }> = [
    { claim: 'te_claim_mail_claim', failed: 'te_claim_mail_failed', groups: rows => {
      const by = new Map<string, ClaimRow[]>()
      for (const r of rows as ClaimRow[]) { const k = r.employee_id ?? r.id; by.set(k, [...(by.get(k) ?? []), r]) }
      return [...by.values()].map(rs => ({ ids: rs.map(x => x.id), first: rs[0], words: () => (rs.length === 1 ? claimWords(rs[0], APP) : claimsWords(rs, APP)) }))
    } },
    { claim: 'te_dep_mail_claim', failed: 'te_dep_mail_failed', groups: rows => (rows as DepRow[]).map(r => ({ ids: [r.id], first: r, words: () => depWords(r, APP) })) },
  ]
  for (const k of kinds) {
    const { data: kd, error: ke } = await db.rpc(k.claim, { p_limit: 20 })
    if (ke) continue
    for (const g of k.groups((kd ?? []) as unknown[])) {
      const { to, cc } = copiesTo(g.first)
      more += g.ids.length
      const fail = (msg: string) => Promise.all(g.ids.map(id => db.rpc(k.failed, { p_id: id, p_error: msg })))
      if (!to.length) { noAddress++; await fail('No work email for the person, the manager or the Travel Desk'); continue }
      if (sent + failed > 0) await new Promise(res => setTimeout(res, 2000))
      try {
        await sendMail(db as never, { to, cc, ...g.words() })
        sent++
      } catch (e) {
        failed++
        await fail((e as Error).message)
      }
    }
  }
  return json({ claimed: rows.length + vrows.length + mrows.length + more, sent, failed, noAddress })
})
