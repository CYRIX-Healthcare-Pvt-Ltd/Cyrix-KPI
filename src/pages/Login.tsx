import { useState, type FormEvent } from 'react'
import ThemeToggle from '@/components/ThemeToggle'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { requestOtp, submitOtp } from '@/lib/passwordOtp'
import { emailFeedback, isOfficialEmail, OFFICIAL_DOMAIN } from '@/lib/officialEmail'
import { Alert, Spinner } from '@/components/ui'
import { Logo, ProductMark } from '@/components/Logo'

/**
 * Split hero, matching the house style of Cyrix's other platforms: black
 * brand panel on the left, white form on the right, uppercase
 * letterspaced labels and underline inputs.
 */
export default function Login() {
  const { session, signIn, loading } = useAuth()
  const location = useLocation()
  const [ecode, setEcode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')

  if (!loading && session) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(ecode, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ---------------- brand panel ---------------- */}
      <aside className="relative hidden flex-col justify-between bg-shade p-12 lg:flex">
        <Logo height={40} variant="light" />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-label text-white/45">
            Performance Management Platform
          </p>
          <div className="mt-5">
            <ProductMark className="text-7xl" />
          </div>
          <p className="mt-7 max-w-sm text-[15px] leading-relaxed text-white/60">
            Measure. Review. Grow.
            <br />
            Monthly KPI tracking and appraisal scoring across every team.
          </p>
        </div>

        <div className="flex items-end justify-between">
          <ul className="space-y-1.5 text-[11px] font-medium uppercase tracking-label text-white/35">
            <li>Monthly Submission</li>
            <li>Manager Review</li>
            <li>Appraisal Insight</li>
          </ul>
          <p className="text-[11px] font-medium uppercase tracking-label text-white/35">
            India Operations
          </p>
        </div>
      </aside>

      {/* ---------------- form panel ---------------- */}
      <main className="flex flex-col justify-between bg-surface px-6 py-10 sm:px-12 lg:px-16 lg:py-12">
        {/* The switch belongs here too: this is the first screen anyone
            sees, and somebody who prefers dark should not have to sign in
            through a white page to reach the control that fixes it. */}
        <div className="flex items-start justify-between gap-3">
          {/* Brand shows here only on small screens, where the panel is hidden. */}
          <div className="lg:hidden">
            <Logo height={34} />
          </div>
          <ThemeToggle className="ml-auto" />
        </div>

        <div className="mx-auto w-full max-w-sm py-10 lg:py-0">
          {mode === 'forgot' && (
            <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
              Account Recovery
            </p>
          )}
          <h1 className="text-4xl font-bold tracking-tight text-ink-900">
            {mode === 'signin' ? 'Sign in to continue.' : 'Reset your password.'}
          </h1>

          {mode === 'forgot' ? (
            <ForgotPassword
              onBack={code => {
                setMode('signin')
                // The employee code comes back filled in; the password
                // deliberately does not. It used to be pre-filled because
                // a reset made the password the employee code, and that
                // is exactly the behaviour this replaced.
                if (code) { setEcode(code); setPassword(''); setError(null) }
              }}
            />
          ) : (
            <form onSubmit={onSubmit} className="mt-10 space-y-7">
              {error && <Alert kind="error">{error}</Alert>}

              <Field
                id="ecode"
                label="Employee Code"
                value={ecode}
                onChange={v => setEcode(v.toUpperCase())}
                placeholder="E1042"
                autoComplete="username"
                autoFocus
                uppercase
              />

              {/* Forgot sits below the field's rule, right-aligned — it is
                  what you reach for after the password fails, not before
                  you type it. */}
              <Field
                id="password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                below={
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(null) }}
                    className="ml-auto block text-[11px] font-semibold uppercase tracking-label text-ink-400 transition-colors hover:text-cyrixRed-600"
                  >
                    Forgot Password?
                  </button>
                }
              />

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-onInk hover:bg-cyrixRed-600 hover:text-white disabled:opacity-60"
              >
                {busy && <Spinner className="h-4 w-4" />}
                {busy ? 'Signing In' : 'Sign In'}
              </button>
            </form>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink-200 pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-label text-ink-500">
            Cyrix Healthcare
          </p>
          <p className="text-[11px] font-medium uppercase tracking-label text-ink-400">
            © {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  )
}

function Field({
  id, label, value, onChange, type = 'text', placeholder, autoComplete,
  autoFocus, uppercase, hint, disabled, error, onBlur, below,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
  uppercase?: boolean
  hint?: string
  /**
   * Answered already and not up for revision — the employee code and
   * email are what the emailed code was issued against, so letting them
   * change while it is being typed would only produce a code that no
   * longer matches anything.
   */
  disabled?: boolean
  /** Replaces the hint and turns the rule red. */
  error?: string | null
  /** Leaving the field is what counts as having finished typing in it. */
  onBlur?: () => void
  /** Rendered under the field's rule, e.g. the forgot-password link. */
  below?: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-label text-ink-500"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        autoCapitalize={uppercase ? 'characters' : undefined}
        autoCorrect="off"
        spellCheck={false}
        required
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        className={`mt-2 w-full border-0 border-b bg-transparent px-0 py-2.5
                    text-lg text-ink-900 placeholder:text-ink-300
                    focus:outline-none focus:ring-0 ${uppercase ? 'uppercase' : ''} ${
                      error
                        ? 'border-cyrixRed-500 focus:border-cyrixRed-600'
                        : 'border-ink-300 focus:border-ink-900'
                    }`}
      />
      {/* The rule under the field is the whole visual language of this
          screen, so the error uses it rather than adding a box. */}
      {error
        ? <p className="mt-2 text-xs font-medium text-cyrixRed-600">{error}</p>
        : hint && <p className="mt-2 text-xs text-ink-400">{hint}</p>}
      {below && <div className="mt-2.5">{below}</div>}
    </div>
  )
}

/**
 * Proving it is your account before letting you take it back.
 *
 * This used to set the password back to the employee code, which meant
 * the only thing standing between somebody and a colleague's account was
 * knowing an employee code — a number printed on their badge. The
 * self_service_password_reset switch was the sole guard, which is why it
 * had to stay off and why nobody could actually use this.
 *
 * Now a code goes to the address on that person's record and nothing
 * happens until it comes back.
 *
 * Note what is NOT said on this screen. Whether that employee code
 * exists, whether the address matches, whether there is an address at
 * all — every one of those comes back as the same sentence, because
 * anything more specific turns this form into a way to find out who
 * works here. The server decides that; this only prints it.
 */
function ForgotPassword({ onBack }: { onBack: (code?: string) => void }) {
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [sent, setSent] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const emailProblem = emailFeedback(email, touched)

  const send = async () => {
    const r = await requestOtp({ purpose: 'reset', ecode: code.trim(), email: email.trim() })
    // Deliberately advances even when nothing was sent. Stopping here on
    // a wrong address is the same as saying "that address is wrong",
    // which is the thing this screen must never say.
    if (!r.ok && r.message) { setError(r.message); return }
    setSent(true)
    setNotice(r.message)
  }

  const finish = async () => {
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== confirm) { setError('The two passwords do not match.'); return }
    if (pw.toLowerCase() === code.trim().toLowerCase()) {
      setError('Your new password cannot be your employee code.')
      return
    }
    const r = await submitOtp({
      purpose: 'reset', ecode: code.trim(), code: otp, password: pw,
    })
    if (!r.ok) { setError(r.message); return }
    setDone(true)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)
    setBusy(true)
    try {
      await (sent ? finish() : send())
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-10 space-y-6">
        <Alert kind="success" title="Password changed">
          Sign in as <strong>{code.trim().toUpperCase()}</strong> with your new password.
        </Alert>
        <button
          onClick={() => onBack(code.trim().toUpperCase())}
          className="w-full btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-onInk hover:bg-cyrixRed-600 hover:text-white"
        >
          Back to Sign In
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-7">
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Field
        id="forgot-ecode"
        label="Employee Code"
        value={code}
        onChange={v => setCode(v.toUpperCase())}
        placeholder="E1042"
        autoFocus={!sent}
        uppercase
        disabled={sent}
      />

      <Field
        id="forgot-email"
        label="Official Email"
        type="email"
        value={email}
        onChange={v => { setEmail(v); if (touched) setTouched(false) }}
        placeholder={`you@${OFFICIAL_DOMAIN}`}
        disabled={sent}
        onBlur={() => setTouched(true)}
        error={sent ? null : emailProblem}
        hint={sent ? undefined : 'The email on your employee record. HR can tell you which one that is.'}
      />

      {sent && (
        <>
          <Field
            id="forgot-otp"
            label="Code From Your Email"
            value={otp}
            onChange={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            autoFocus
            hint="Six digits, good for 10 minutes."
          />
          <Field
            id="forgot-pw"
            label="New Password"
            type="password"
            value={pw}
            onChange={setPw}
            hint="At least 8 characters."
          />
          <Field
            id="forgot-confirm"
            label="Confirm New Password"
            type="password"
            value={confirm}
            onChange={setConfirm}
          />
        </>
      )}

      <button
        type="submit"
        disabled={busy || (sent && otp.length < 6) || (!sent && !isOfficialEmail(email))}
        className="flex w-full items-center justify-center gap-2 btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-onInk hover:bg-cyrixRed-600 hover:text-white disabled:opacity-60"
      >
        {busy && <Spinner className="h-4 w-4" />}
        {busy ? 'Working' : sent ? 'Set My Password' : 'Email Me A Code'}
      </button>

      {sent && (
        <button
          type="button"
          onClick={() => { setSent(false); setOtp(''); setNotice(null); setError(null) }}
          className="w-full text-[11px] font-semibold uppercase tracking-label text-ink-400 transition-colors hover:text-ink-900"
        >
          Use A Different Code Or Email
        </button>
      )}

      <button
        type="button"
        onClick={() => onBack()}
        className="w-full text-[11px] font-semibold uppercase tracking-label text-ink-400 transition-colors hover:text-ink-900"
      >
        Back to Sign In
      </button>
    </form>
  )
}
