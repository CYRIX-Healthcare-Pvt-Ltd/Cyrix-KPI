import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Alert, Spinner } from '@/components/ui'

const MIN_LENGTH = 8

export default function ChangePassword() {
  const { employee, changePassword, signOut, forcePasswordChange } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only a forced visit when the setting is on; otherwise this page is
  // reached voluntarily from the header and offers a way back.
  const forced = forcePasswordChange && (employee?.must_change_password ?? false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (pw.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (pw !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    if (employee && pw.toLowerCase() === employee.ecode.toLowerCase()) {
      setError('Your new password cannot be your employee code.')
      return
    }

    setBusy(true)
    try {
      await changePassword(pw)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            {forced ? 'Set your password' : 'Change password'}
          </h1>
          {forced && (
            <p className="mt-1.5 text-sm text-slate-500">
              You are signed in with your employee code as the password. Choose a
              new one to continue.
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && <Alert kind="error">{error}</Alert>}

          <div>
            <label className="label" htmlFor="pw">New password</label>
            <input
              id="pw"
              type="password"
              className="input"
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
            <p className="mt-1.5 text-xs text-slate-500">
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
              autoComplete="new-password"
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {busy ? 'Saving…' : 'Save password'}
          </button>

          {forced ? (
            <button
              type="button"
              onClick={() => signOut().then(() => navigate('/login', { replace: true }))}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-700"
            >
              Sign out instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
