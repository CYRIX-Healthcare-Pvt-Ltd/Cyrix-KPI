import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, friendlyError } from '@/lib/supabase'
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
      <aside className="relative hidden flex-col justify-between bg-ink-950 p-12 lg:flex">
        <Logo className="text-lg" variant="light" />

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
      <main className="flex flex-col justify-between bg-white px-6 py-10 sm:px-12 lg:px-16 lg:py-12">
        {/* Brand shows here only on small screens, where the panel is hidden. */}
        <div className="lg:hidden">
          <Logo className="text-lg" />
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
                if (code) { setEcode(code); setPassword(code); setError(null) }
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
                className="flex w-full items-center justify-center gap-2 btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-white hover:bg-cyrixRed-600 disabled:opacity-60"
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
  autoFocus, uppercase, hint, below,
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
                    text-lg text-ink-900 placeholder:text-ink-300 focus:border-ink-900
                    focus:outline-none focus:ring-0 ${uppercase ? 'uppercase' : ''}`}
      />
      {hint && <p className="mt-2 text-xs text-ink-400">{hint}</p>}
      {below && <div className="mt-2.5">{below}</div>}
    </div>
  )
}

/**
 * Resets an account back to ecode-as-password. Gated server-side on the
 * self_service_password_reset setting, so switching it off before go-live
 * needs no change here.
 */
function ForgotPassword({ onBack }: { onBack: (code?: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('request_password_reset', {
        p_ecode: code.trim(),
      })
      if (rpcError) throw new Error(friendlyError(rpcError))
      setDone((data as { ecode: string }).ecode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-10 space-y-6">
        <Alert kind="success" title="Password reset">
          Sign in as <strong>{done}</strong> with the password <strong>{done}</strong>.
        </Alert>
        <button
          onClick={() => onBack(done)}
          className="w-full btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-white hover:bg-cyrixRed-600"
        >
          Back to Sign In
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-7">
      {error && <Alert kind="error">{error}</Alert>}

      <Field
        id="forgot-ecode"
        label="Employee Code"
        value={code}
        onChange={v => setCode(v.toUpperCase())}
        placeholder="E1042"
        autoFocus
        uppercase
        hint="Your password will be set back to your employee code."
      />

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 btn-press bg-ink-950 py-4 text-[12px] font-bold uppercase tracking-label text-white hover:bg-cyrixRed-600 disabled:opacity-60"
      >
        {busy && <Spinner className="h-4 w-4" />}
        {busy ? 'Resetting' : 'Reset My Password'}
      </button>

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
