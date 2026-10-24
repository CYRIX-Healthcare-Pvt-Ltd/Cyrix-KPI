import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendMail } from '../_shared/mail.ts'
import { recipients, words, type AdvanceRow } from './words.ts'

/**
 * Travel Expense's mail: an expense advance the Travel Desk has approved, to the person with copies to their
 * reporting manager and the Travel Desk (Travel te_0067; the user, 24 Oct). The words are in words.ts.
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
  return json({ claimed: rows.length, sent, failed, noAddress })
})
