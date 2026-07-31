import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, Spinner } from '@/components/ui'

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 text-xl font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Cyrix KPI</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with your employee code
          </p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && <Alert kind="error">{error}</Alert>}

          <div>
            <label className="label" htmlFor="ecode">Employee code</label>
            <input
              id="ecode"
              className="input"
              value={ecode}
              onChange={e => setEcode(e.target.value)}
              placeholder="e.g. E1042"
              autoComplete="username"
              autoCapitalize="characters"
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
              Signing in for the first time? Your password is your employee code.
            </p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Forgotten your password? Contact HR to have it reset.
        </p>
      </div>
    </div>
  )
}
