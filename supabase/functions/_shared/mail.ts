/**
 * The one way out for every email this app sends.
 *
 * Microsoft Graph, sending as the mailbox in MAIL_FROM —
 * notifications@cyrix.in — with an app registration whose Mail.Send is
 * scoped in Exchange to that one mailbox and nothing else in the tenant.
 * Company mail from a company address, rather than from a third party's
 * domain that has to be explained to anybody who checks the headers.
 *
 * Secrets, all four or none:
 *
 *   MS_TENANT_ID      Directory (tenant) ID
 *   MS_CLIENT_ID      Application (client) ID
 *   MS_CLIENT_SECRET  the secret's VALUE, not its ID
 *   MAIL_FROM         "Cyrix <notifications@cyrix.in>", or the bare address
 *
 * Resend stays behind it while the switch settles, and only while
 * RESEND_API_KEY is still set: a password code that cannot be sent is
 * somebody locked out of their account, and a misconfigured tenant
 * should not be the thing that does that to them. The route taken comes
 * back on every send, so a fallback is visible in the function log
 * rather than silent. Once Graph has carried the mail for a week, delete
 * the secret and this file loses the branch.
 *
 * Two things are lost by leaving Resend and are worth knowing rather
 * than discovering:
 *
 *   - No message id, so mail-events has nothing to correlate. Delivery
 *     is answered from the mailbox's Sent Items and, if it comes to it,
 *     a message trace in the Microsoft admin centre.
 *   - One body, not two. Graph's sendMail takes a single ItemBody, so
 *     the plain-text alternative is dropped and the HTML is what every
 *     client renders. The code emails are a paragraph and a number, so
 *     there is nothing in them a text-only client would lose.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'
const LOGIN = 'https://login.microsoftonline.com'

/** What a mail provider said when it would not take a message. */
export class MailRefused extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`mail provider refused: ${status}`)
    this.name = 'MailRefused'
  }
}

export interface Mail {
  to: string[]
  cc?: string[]
  subject: string
  /** Used by Resend only; Graph takes the HTML. */
  text: string
  html: string
}

export interface Sent {
  via: 'graph' | 'resend'
  /** The provider's own handle on the message. Graph gives none. */
  id: string | null
  /** Why the fallback was used, when it was. */
  note?: string
}

/**
 * Anything that can call an RPC — the functions' own supabase client.
 *
 * PromiseLike, not Promise: supabase's rpc() hands back a query builder
 * that is awaited rather than a promise, and asking for the stricter
 * type here rejects the very client this is called with.
 */
interface Db {
  rpc(name: string): PromiseLike<{ data: unknown }>
}

const env = (k: string) => Deno.env.get(k)?.trim() || null

/** "Cyrix <notifications@cyrix.in>" into its two halves. */
export function splitAddress(value: string): { name: string | null; address: string } {
  const m = value.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/)
  return m
    ? { name: m[1].replace(/^"|"$/g, '') || null, address: m[2] }
    : { name: null, address: value.trim() }
}

export const graphConfigured = (): boolean =>
  Boolean(env('MS_TENANT_ID') && env('MS_CLIENT_ID')
    && env('MS_CLIENT_SECRET') && env('MAIL_FROM'))

/**
 * The address Resend sends from: SW Admin's setting, then the secret.
 *
 * Graph does not use it. It can only send as the mailbox it is scoped
 * to, so MAIL_FROM is the address there and the setting would be a way
 * to break sending from a text box.
 */
export async function senderAddress(db: Db): Promise<string> {
  try {
    const { data } = await db.rpc('otp_sender')
    if (typeof data === 'string' && data.includes('@')) return data
  } catch { /* fall through to the secret */ }
  return env('OTP_FROM') ?? 'Cyrix <no-reply@updates.cyrix.in>'
}

/*
  One token per isolate, reused until it is nearly out.

  Client-credentials tokens last an hour and cost a round trip to
  Microsoft each time. Two minutes of margin, because the alternative is
  a token that expires between being fetched and being used.
*/
let token: { value: string; until: number } | null = null

async function graphToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value

  const res = await fetch(`${LOGIN}/${env('MS_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('MS_CLIENT_ID')!,
      client_secret: env('MS_CLIENT_SECRET')!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })

  const body = await res.text()
  // Microsoft's AADSTS code is the whole diagnosis — 7000215 is a wrong
  // secret, 700016 a wrong client id, 90002 a wrong tenant — so it is
  // carried through rather than flattened into "could not authenticate".
  if (!res.ok) throw new MailRefused(res.status, body.slice(0, 500))

  const json = JSON.parse(body) as { access_token: string; expires_in: number }
  token = { value: json.access_token, until: Date.now() + (json.expires_in - 120) * 1000 }
  return json.access_token
}

async function viaGraph(mail: Mail): Promise<Sent> {
  const from = splitAddress(env('MAIL_FROM')!)
  const recipient = (address: string) => ({ emailAddress: { address } })

  const res = await fetch(
    `${GRAPH}/users/${encodeURIComponent(from.address)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await graphToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: 'HTML', content: mail.html },
          toRecipients: mail.to.map(recipient),
          ccRecipients: (mail.cc ?? []).map(recipient),
          ...(from.name
            ? { from: { emailAddress: { address: from.address, name: from.name } } }
            : {}),
        },
        // Kept, deliberately. Without a message id there is no other way
        // to answer "was it actually sent" from inside the company, and
        // a shared mailbox has room for a year of these.
        saveToSentItems: true,
      }),
    })

  // 202 with an empty body is the success case.
  if (!res.ok) throw new MailRefused(res.status, (await res.text()).slice(0, 500))
  return { via: 'graph', id: null }
}

async function viaResend(db: Db, mail: Mail): Promise<Sent> {
  const key = env('RESEND_API_KEY')
  if (!key) throw new Error('no mail provider is configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: await senderAddress(db),
      to: mail.to,
      ...(mail.cc?.length ? { cc: mail.cc } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  })
  if (!res.ok) throw new MailRefused(res.status, (await res.text()).slice(0, 500))

  try {
    const accepted = await res.json()
    return { via: 'resend', id: typeof accepted?.id === 'string' ? accepted.id : null }
  } catch {
    return { via: 'resend', id: null }
  }
}

/** Graph if it is configured, Resend if it is not — or if Graph refuses. */
export async function sendMail(db: Db, mail: Mail): Promise<Sent> {
  if (!graphConfigured()) return viaResend(db, mail)

  try {
    return await viaGraph(mail)
  } catch (err) {
    if (!env('RESEND_API_KEY')) throw err
    const note = err instanceof MailRefused
      ? `graph refused ${err.status}: ${err.detail.slice(0, 200)}`
      : `graph failed: ${String(err).slice(0, 200)}`
    console.error(note)
    const sent = await viaResend(db, mail)
    return { ...sent, note }
  }
}
