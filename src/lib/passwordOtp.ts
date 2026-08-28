import { supabase } from './supabase'

/**
 * Talking to the password-otp edge function.
 *
 * Thin on purpose: every decision that matters — whether a code may be
 * issued, whether one is right, what a stranger is told — is made on the
 * server. Nothing here is a check; it is a phone line.
 */

export type OtpPurpose = 'reset' | 'change'

export interface OtpReply {
  ok: boolean
  message: string
}

/**
 * The token this request travels with.
 *
 * Signed in, it is their session. Signed out — which is most of the
 * point of a password reset — it is the publishable key, which is what
 * the gateway wants in front of a function that verifies JWTs.
 *
 * Set here rather than left to functions.invoke, which stopped
 * attaching it at all once the project moved to sb_publishable keys.
 * The gateway then refused every anonymous call with
 * UNAUTHORIZED_NO_AUTH_HEADER before the function ran, so the whole
 * forgot-password flow answered a spinner that never stopped — while
 * the same call with the header set worked perfectly, which is exactly
 * the shape of bug that survives testing from a terminal.
 */
async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  return `Bearer ${token}`
}

async function call(body: Record<string, unknown>): Promise<OtpReply> {
  const { data, error } = await supabase.functions.invoke('password-otp', {
    body,
    headers: { Authorization: await authHeader() },
  })

  // A non-2xx comes back as an error with the body on the context, and
  // the body is where the sentence written for the reader lives.
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const said = await ctx.json()
        if (said?.error) return { ok: false, message: String(said.error) }
      } catch { /* not JSON; fall through to the generic */ }
    }
    return {
      ok: false,
      message: error.message?.includes('Failed to send')
        ? 'Could not reach the server. Check your connection.'
        : 'Something went wrong. Try again shortly.',
    }
  }

  const said = data as { ok?: boolean; message?: string; error?: string }
  if (said?.error) return { ok: false, message: said.error }
  return { ok: !!said?.ok, message: said?.message ?? '' }
}

/**
 * Send a code to the address on this person's record.
 *
 * The email is what the person typed, not what we hold — the server
 * compares the two and refuses if they differ. Passing our own copy
 * would make the field decoration.
 */
export const requestOtp = (args: {
  purpose: OtpPurpose
  email: string
  /** Only for reset; a signed-in change is identified by its token. */
  ecode?: string
}): Promise<OtpReply> =>
  call({ action: 'request', purpose: args.purpose, email: args.email, ecode: args.ecode })

/** Hand back the code and the new password. One round trip, one answer. */
export const submitOtp = (args: {
  purpose: OtpPurpose
  code: string
  password: string
  ecode?: string
}): Promise<OtpReply> =>
  call({
    action: 'submit',
    purpose: args.purpose,
    code: args.code,
    password: args.password,
    ecode: args.ecode,
  })

/**
 * Prove the sender address works, before it matters.
 *
 * The target is an EMPLOYEE CODE, never an address — blank means the SW
 * Admin themselves. That distinction is the whole safeguard: a free-text
 * address field on an admin screen is a way to aim the company's mail
 * reputation at whoever you like, whereas an employee code can only ever
 * reach somebody the company already has on file.
 */
export const sendOtpTest = (target?: string): Promise<OtpReply> =>
  call({ action: 'test', purpose: 'change', target: (target ?? '').trim() })
