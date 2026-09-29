/**
 * Pulse roles — admin or director, for people already granted the Pulse tile.
 *
 * Pulse's own data (SQL Server on cyrix-svc01) is not in this Supabase
 * project, so this can't read/write a table directly the way Spare, BEMMP
 * and Revive Lab do on their tabs -- it calls Pulse's own admin API instead
 * (Pulse/backend/app/routers/pulse_roles.py), using the signed-in admin's
 * own Supabase session token. That API is reachable at /pulse/api/admin/... ,
 * same-origin as this page once loaded under app.cyrix.in (the /pulse/
 * rewrite in cyrix-platform's vercel.json) -- no CORS setup needed.
 *
 * Replaces Pulse's own /user-management page (PulseUsers/bcrypt local
 * accounts, removed once this shipped). Whether somebody sees the Pulse
 * tile at all is still the Modules column on the Logins tab; this decides
 * what they can do once they're in.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Alert, EmptyState, Spinner, StatTile } from '@/components/ui'

interface PulseRole {
  employee_id: string
  ecode: string
  full_name: string
  work_email: string | null
  role: 'admin' | 'director'
}

async function pulseApi<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in.')
  const resp = await fetch(`/pulse/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    throw new Error(body?.detail ?? `Pulse API error (${resp.status}).`)
  }
  return resp.status === 204 ? (undefined as T) : resp.json()
}

export default function Access() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Pulse roles</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Who is a Pulse admin, for people already granted the tile.
        </p>
      </div>
      <PulseAccess />
    </div>
  )
}

export function PulseAccess() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['pulse', 'roles'],
    queryFn: () => pulseApi<PulseRole[]>('/admin/pulse-roles'),
  })

  const setRole = useMutation({
    mutationFn: ({ employeeId, role }: { employeeId: string; role: 'admin' | 'director' }) =>
      pulseApi<PulseRole>(`/admin/pulse-roles/${employeeId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
    onSuccess: row => {
      setNotice(`${row.full_name} is now ${row.role === 'admin' ? 'a Pulse admin' : 'a Pulse director'}.`)
      qc.invalidateQueries({ queryKey: ['pulse', 'roles'] })
    },
    onError: err => setError(err instanceof Error ? err.message : 'Could not change that.'),
  })

  const filtered = (data ?? []).filter(r => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return r.full_name.toLowerCase().includes(q) || r.ecode.toLowerCase().includes(q)
  })

  const admins = (data ?? []).filter(r => r.role === 'admin').length

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-ink-400" /></div>
  }
  if (loadError) {
    return <Alert kind="error">{loadError instanceof Error ? loadError.message : 'Could not load Pulse roles.'}</Alert>
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Granted the tile" value={(data ?? []).length} />
        <StatTile label="Admins" value={admins} sub="user management, audit log, data security" />
        <StatTile label="Directors" value={(data ?? []).length - admins} />
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <div>
          <p className="font-medium text-ink-900">A role is not a tile</p>
          <p className="mt-1">
            This decides what somebody can do inside Pulse once they're in. Whether
            they're offered it at all is the Modules column on the Logins tab — a
            person can hold a role here and never see the tile.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input !py-1.5 !pl-8"
              placeholder="Name or code"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ShieldCheck} title={search ? 'Nobody matches that' : 'Nobody has the Pulse tile yet'}>
              {!search && 'Grant it on the Logins tab first.'}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(r => (
                  <tr key={r.employee_id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{r.full_name}</p>
                      <p className="text-xs text-ink-500">
                        {r.ecode}{r.work_email ? ` · ${r.work_email}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(['director', 'admin'] as const).map(role => (
                          <button
                            key={role}
                            type="button"
                            disabled={setRole.isPending}
                            title={`Make ${r.full_name} a Pulse ${role}`}
                            aria-pressed={r.role === role}
                            onClick={() => {
                              setError(null); setNotice(null)
                              setRole.mutate({ employeeId: r.employee_id, role })
                            }}
                            className={clsx(
                              'badge cursor-pointer transition-colors disabled:opacity-50',
                              r.role === role
                                ? role === 'admin'
                                  ? 'bg-cyrixRed-600 text-white'
                                  : 'bg-ink-900 text-onInk'
                                : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                            )}
                          >
                            {role === 'admin' ? 'Admin' : 'Director'}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
