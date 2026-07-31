import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { KeyRound, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, Spinner } from '@/components/ui'

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-xl font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Cyrix KPI</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'signin'
              ? 'Sign in with your employee code'
              : 'Reset your password'}
          </p>
        </div>

        {mode === 'forgot' ? (
          <ForgotPassword
            onBack={code => {
              setMode('signin')
              if (code) { setEcode(code); setPassword(code); setError(null) }
            }}
          />
        ) : (
          <>
            <form onSubmit={onSubmit} className="card space-y-4 p-6">
              {error && <Alert kind="error">{error}</Alert>}

              <div>
                <label className="label" htmlFor="ecode">Employee code</label>
                <input
                  id="ecode"
                  className="input uppercase"
                  value={ecode}
                  // Codes are stored in capitals, and the password is the code,
                  // so normalise here rather than let a lowercase entry fail.
                  onChange={e => setEcode(e.target.value.toUpperCase())}
                  placeholder="E1042"
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Your password is your employee code, in capitals.
                </p>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy && <Spinner className="h-4 w-4" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>

              {/* Fills both fields from the code already typed — this is a
                  testing convenience and comes out before go-live. */}
              {ecode.trim() !== '' && password === '' && (
                <button
                  type="button"
                  onClick={() => setPassword(ecode.trim().toUpperCase())}
                  className="w-full text-center text-xs text-slate-400 hover:text-slate-600"
                >
                  Use my employee code as the password
                </button>
              )}
            </form>

            <button
              onClick={() => { setMode('forgot'); setError(null) }}
              className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Forgotten your password?
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Resets an account back to ecode-as-password. Calls request_password_reset(),
 * which is anonymous-callable by design — the person using it is locked out —
 * and gated on the self_service_password_reset setting, so turning it off
 * before go-live needs no code change here.
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
      <div className="card space-y-4 p-6">
        <Alert kind="success" title="Password reset">
          <p>
            Sign in as <strong>{done}</strong> with the password{' '}
            <strong>{done}</strong>.
          </p>
        </Alert>
        <button onClick={() => onBack(done)} className="btn-primary w-full">
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <>
      <form onSubmit={submit} className="card space-y-4 p-6">
        {error && <Alert kind="error">{error}</Alert>}

        <div>
          <label className="label" htmlFor="forgot-ecode">Employee code</label>
          <input
            id="forgot-ecode"
            className="input uppercase"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="E1042"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Your password will be set back to your employee code.
          </p>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? 'Resetting…' : 'Reset my password'}
        </button>
      </form>

      <button
        onClick={() => onBack()}
        className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>
    </>
  )
}
