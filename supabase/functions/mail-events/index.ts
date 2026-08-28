import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * What the mail provider says happened after it accepted a message.
 *
 * A code went to a real address, Resend returned 2xx, and nothing
 * arrived — not the inbox, not spam. Accepting a message is not
 * delivering it, and until this existed the system could not tell the
 * difference between delivered, bounced, and quietly discarded.
 *
 * Resend posts here on every event. Nothing it says is believed until
 * the signature checks out: this endpoint is public, and an unsigned
 * "delivered" from a stranger would be worse than no record at all —
 * it would be a false record that somebody trusts.
 *
 * Deploy:  supabase functions deploy mail-events --no-verify-jwt
 *          (--no-verify-jwt because Resend has no Supabase token; the
 *           Svix signature is what authenticates this endpoint, and it
 *           is checked before anything is written.)
 * Secret:  supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...
 *          (from Resend -> Webhooks -> your endpoint)
 */

/** Five minutes either way. Beyond that it is a replay, not a retry. */
const TOLERANCE_SECONDS = 5 * 60

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

/** Constant time, so a wrong signature cannot be found one byte at a time. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const fromBase64 = (s: string) =>
  Uint8Array.from(atob(s), ch => ch.charCodeAt(0))

/**
 * Svix signing, which is what Resend uses.
 *
 * The signed content is id.timestamp.body — the timestamp is in there
 * precisely so a captured request cannot be replayed tomorrow, which is
 * why it is checked as well as the digest.
 */
async function signatureOk(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not set')

  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const header = req.headers.get('svix-signature')
  if (!id || !timestamp || !header) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

  // whsec_<base64>. The prefix is a label, not part of the key.
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const key = await crypto.subtle.importKey(
    'raw', fromBase64(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mine = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  )

  // The header carries every currently valid key as "v1,<sig> v1,<sig>",
  // so a rotation does not drop events on the floor mid-flight.
  for (const part of header.split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    try {
      if (sameBytes(mine, fromBase64(sig))) return true
    } catch { /* not base64; try the next */ }
  }
  return false
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })

  // Read once, as text: the signature is over the exact bytes sent, and
  // re-serialising parsed JSON would not reproduce them.
  const body = await req.text()

  let verified: boolean
  try {
    verified = await signatureOk(req, body)
  } catch (err) {
    console.error('mail-events not configured', err)
    return new Response('not configured', { status: 500 })
  }
  if (!verified) {
    console.warn('mail-events rejected an unsigned or stale request')
    return new Response('bad signature', { status: 401 })
  }

  let event: {
    type?: string
    created_at?: string
    data?: { email_id?: string; to?: string[]; from?: string; subject?: string }
  }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const messageId = event.data?.email_id
  if (!event.type || !messageId) {
    // Signed, so it is genuinely from the provider — just not a shape we
    // know. Accepted rather than retried forever.
    console.warn('mail-events ignored an unrecognised payload', event.type)
    return new Response('ignored', { status: 200 })
  }

  const db = admin()
  try {
    // One row per recipient: a message to two people that bounces for
    // one of them is not a message that bounced.
    for (const to of event.data?.to ?? [null]) {
      await db.rpc('record_mail_event', {
        p_provider_id: messageId,
        p_event: event.type,
        p_recipient: to,
        p_detail: {
          subject: event.data?.subject ?? null,
          from: event.data?.from ?? null,
        },
        p_occurred_at: event.created_at ?? new Date().toISOString(),
      })
    }
  } catch (err) {
    // A 5xx makes the provider retry, which is what we want for a
    // database that was briefly unavailable.
    console.error('mail-events could not record', err)
    return new Response('could not record', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
