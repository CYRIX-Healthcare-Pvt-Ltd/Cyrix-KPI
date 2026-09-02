import { useState, type FormEvent } from 'react'
import ThemeToggle from '@/components/ThemeToggle'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, Spinner } from '@/components/ui'
import { Logo, ProductMark } from '@/components/Logo'

/**
 * Split hero, matching the house style of Cyrix's other platforms: black
 * brand panel on the left, white form on the right, uppercase
 * letterspaced labels and underline inputs.
 */

/**
 * Where somebody who cannot sign in is sent.
 *
 * Recovery used to be a second mode of this screen. It belongs at the
 * front door instead: a forgotten password locks you out of every
 * module, not this one, and the portal is the only screen all four share.
 * `?reset` opens it straight into the flow rather than onto a sign-in
 * with a link to find.
 *
 * Root-relative, which is app.cyrix.in on the domain people use. The
 * module's own vercel.json bounces / back to /kpi/, so on the raw
 * deployment URL this lands back here rather than anywhere wrong.
 */
const RESET_URL = '/?reset=1'

export default function Login() {
  const { session, signIn, loading } = useAuth()
  const location = useLocation()
  const [ecode, setEcode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        {/* `shade` is pinned black in both themes, so this panel does not
            follow the toggle and neither may the lockup on it. */}
        <Logo height={40} onDark />

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
          <h1 className="text-4xl font-bold tracking-tight text-ink-900">
            Sign in to continue.
          </h1>

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
                you type it. A link out to the portal rather than a mode
                of this screen: see RESET_URL. */}
            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              below={
                <a
                  href={RESET_URL}
                  className="ml-auto block w-fit text-[11px] font-semibold uppercase tracking-label text-ink-400 transition-colors hover:text-cyrixRed-600"
                >
                  Forgot Password?
                </a>
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

/*
 * One underline field.
 *
 * Leaner than it was: the hint, disabled, error and onBlur props existed
 * for the recovery flow that used to share this screen, and went with it
 * to the portal. What is left is what signing in needs.
 */
function Field({
  id, label, value, onChange, type = 'text', placeholder, autoComplete,
  autoFocus, uppercase, below,
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
        autoCapitalize={uppercase ? 'characters' : undefined}
        autoCorrect="off"
        spellCheck={false}
        required
        onChange={e => onChange(e.target.value)}
        className={`mt-2 w-full border-0 border-b border-ink-300 bg-transparent px-0 py-2.5
                    text-lg text-ink-900 placeholder:text-ink-300
                    focus:border-ink-900 focus:outline-none focus:ring-0 ${
                      uppercase ? 'uppercase' : ''
                    }`}
      />
      {below && <div className="mt-2.5">{below}</div>}
    </div>
  )
}
