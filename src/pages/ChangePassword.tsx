import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { MailCheck, ArrowLeft, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, Spinner } from '@/components/ui'
import { requestOtp, submitOtp } from '@/lib/passwordOtp'
import { emailFeedback, isOfficialEmail, OFFICIAL_DOMAIN } from '@/lib/officialEmail'

const MIN_LENGTH = 8

export default function ChangePassword() {
  const { employee, changePassword, signOut, forcePasswordChange } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  // Held back until they leave the field: complaining about "kev" while
  // somebody is still typing "kevin.r@..." is the field arguing with the
  // person filling it in.
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only a forced visit when the setting is on; otherwise this page is
  // reached voluntarily from the header and offers a way back.
  const forced = forcePasswordChange && (employee?.must_change_password ?? false)

  /**
   * Whether a code is asked for at all.
   *
   * Two exemptions, and both are the difference between a safeguard and
   * a locked door.
   *
   * A forced change is somebody signed in with their employee code as
   * their password, who cannot use the app until they pick a real one.
   * Putting an emailed code in front of that would strand every one of
   * them — and today that is all 1,148, because not one employee record
   * has an address on it yet.
   *
   * The same reasoning, softer, for anybody with no address on file: the
   * code cannot be sent, so requiring it would take away a thing they
   * can do today and give nothing back. It degrades to exactly the old
   * behaviour and turns itself on the moment HR adds their address.
   */
  const onRecord = (employee?.work_email ?? '').trim()
  const verify = !forced && onRecord !== ''

  const emailProblem = emailFeedback(email, touched)

  const passwordProblem = (): string | null => {
    if (pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
    if (pw !== confirm) return 'The two passwords do not match.'
    if (employee && pw.toLowerCase() === employee.ecode.toLowerCase()) {
      return 'Your new password cannot be your employee code.'
    }
    return null
  }

  /** No code needed: the old path, unchanged. */
  const saveDirectly = async () => {
    await changePassword(pw)
    navigate('/', { replace: true })
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)

    const problem = passwordProblem()
    if (problem) { setError(problem); return }

    setBusy(true)
    try {
      if (!verify) { await saveDirectly(); return }

      if (!sent) {
        const r = await requestOtp({ purpose: 'change', email })
        if (!r.ok) { setError(r.message); return }
        setSent(true)
        setNotice(r.message)
        return
      }

      const r = await submitOtp({ purpose: 'change', code, password: pw })
      if (!r.ok) { setError(r.message); return }
      // The session still carries the old password's token, and the
      // point of the exercise is that the new one is what works.
      await signOut()
      navigate('/login', { replace: true, state: { changed: true } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-ink-900">
            {forced ? 'Set your password' : 'Change password'}
          </h1>
          {forced && (
            <p className="mt-1.5 text-sm text-ink-500">
              You are signed in with your employee code as the password. Choose a
              new one to continue.
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          {/* Everything above the code is answered first and then locked,
              so the screen the code is typed into is not also a screen
              where the password can still change underneath it. */}
          {verify && (
            <div>
              <label className="label" htmlFor="official-email">Official email</label>
              <input
                id="official-email"
                type="email"
                inputMode="email"
                className={clsx(
                  'input',
                  emailProblem && 'border-cyrixRed-300 bg-cyrixRed-50/40',
                )}
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={sent}
                autoComplete="email"
                placeholder={`you@${OFFICIAL_DOMAIN}`}
                aria-invalid={!!emailProblem}
                aria-describedby="official-email-hint"
                required
              />
              {/* One line, in the same place either way. A message that
                  appears in a slot that was not there a moment ago moves
                  the button out from under the thumb about to press it. */}
              <p
                id="official-email-hint"
                className={clsx(
                  'mt-1.5 flex items-start gap-1.5 text-xs',
                  emailProblem ? 'text-cyrixRed-700' : 'text-ink-500',
                )}
              >
                {emailProblem && <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
                {emailProblem ?? 'We send a code here to check it is really you.'}
              </p>
            </div>
          )}

          <div>
            <label className="label" htmlFor="pw">New password</label>
            <input
              id="pw"
              type="password"
              className="input"
              value={pw}
              onChange={e => setPw(e.target.value)}
              disabled={sent}
              autoComplete="new-password"
              autoFocus={!verify}
              required
            />
            <p className="mt-1.5 text-xs text-ink-500">
              At least {MIN_LENGTH} characters.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              className="input"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              disabled={sent}
              autoComplete="new-password"
              required
            />
          </div>

          {sent && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <label
                className="label flex items-center gap-1.5 !text-emerald-800"
                htmlFor="otp"
              >
                <MailCheck className="h-3.5 w-3.5" /> Code from your email
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="input bg-surface text-center text-xl font-semibold tracking-[0.4em]"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-emerald-800">
                Six digits, good for 10 minutes.
              </p>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={
              busy ||
              (sent && code.length < 6) ||
              // Nothing to gain from sending a code to an address that
              // cannot be on the record.
              (verify && !sent && !isOfficialEmail(email))
            }
          >
            {busy && <Spinner className="h-4 w-4" />}
            {busy
              ? 'Working…'
              : !verify ? 'Save password'
              : sent ? 'Save password'
              : 'Email me a code'}
          </button>

          {sent && (
            <button
              type="button"
              onClick={() => { setSent(false); setCode(''); setNotice(null); setError(null) }}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-ink-500 hover:text-ink-700"
            >
              <ArrowLeft className="h-3 w-3" /> Change the email or password
            </button>
          )}

          {/* No address on file, so no code was possible. Said once,
              plainly, rather than left as a silently weaker screen. */}
          {!forced && !verify && (
            <p className="text-xs text-ink-400">
              Ask HR to add your official email to your record, and this page
              will start confirming changes with a code.
            </p>
          )}

          {forced ? (
            <button
              type="button"
              onClick={() => signOut().then(() => navigate('/login', { replace: true }))}
              className="w-full text-center text-xs text-ink-500 hover:text-ink-700"
            >
              Sign out instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full text-center text-xs text-ink-500 hover:text-ink-700"
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
