import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ShieldAlert, KeyRound, Download, Info } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { exportOrgStatus } from '@/lib/export'
import { PageLoader, Alert, StatTile } from '@/components/ui'

interface LoginStatusRow {
  employee_id: string
  ecode: string
  full_name: string
  designation: string | null
  department: string | null
  is_active: boolean
  manager_ecode: string | null
  manager_name: string | null
  login_email: string | null
  has_login: boolean
  on_issued_default: boolean
  login_created_at: string | null
  last_sign_in_at: string | null
  password_changed_at: string | null
  login_state: string
}

const STATE_STYLE: Record<string, string> = {
  'No login issued': 'bg-cyrixRed-100 text-cyrixRed-800',
  'Never signed in': 'bg-ink-100 text-ink-600',
  'Using the issued default': 'bg-amber-100 text-amber-800',
  'Set their own password': 'bg-emerald-100 text-emerald-800',
}

export default function SwAdmin() {
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')

  const { data, isLoading, error } = useQuery({
    queryKey: ['login_status'],
    queryFn: async () => {
      // PostgREST caps a response at 1,000 rows. With 1,100+ accounts that
      // silently truncates, so page through explicitly.
      const all: LoginStatusRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .rpc('login_status').range(from, from + 999)
        if (error) throw new Error(friendlyError(error))
        const page = (data ?? []) as LoginStatusRow[]
        all.push(...page)
        if (page.length < 1000) break
      }
      return all
    },
  })

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.filter(r => {
      if (stateFilter !== 'all' && r.login_state !== stateFilter) return false
      if (!q) return true
      return (
        r.ecode.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        (r.login_email ?? '').toLowerCase().includes(q) ||
        (r.manager_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, search, stateFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of data ?? []) c[r.login_state] = (c[r.login_state] ?? 0) + 1
    return c
  }, [data])

  if (isLoading) return <PageLoader label="Loading login records…" />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB') : '—')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
            <ShieldAlert className="h-5 w-5 text-cyrixRed-600" />
            Login administration
          </h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {filtered.length} of {data?.length ?? 0} accounts
          </p>
        </div>
        <button
          onClick={() => exportOrgStatus(
            filtered.map(r => ({
              Ecode: r.ecode, Name: r.full_name,
              Designation: r.designation ?? '', Department: r.department ?? '',
              Manager: r.manager_name ?? '', 'Login email': r.login_email ?? '',
              'Login state': r.login_state, Active: r.is_active ? 'Yes' : 'No',
              'Last signed in': r.last_sign_in_at ?? '',
              'Password changed': r.password_changed_at ?? '',
            })),
            'Cyrix-login-status.xlsx', 'Login status',
          )}
          className="btn-secondary"
        >
          <Download className="h-4 w-4" /> Export
        </button>
      </div>

      {/* Said plainly rather than buried: this is the question people ask
          first, and the honest answer is that nobody can answer it. */}
      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div className="text-ink-600">
          <p className="font-medium text-ink-900">Passwords cannot be displayed</p>
          <p className="mt-1">
            They are stored as one-way bcrypt hashes. Nobody can read one back —
            not this screen, not the Supabase dashboard, not a database
            administrator. What is shown instead is whether each person is still
            on the code we issued them, or has set their own.
          </p>
          <p className="mt-1.5">
            While the system is in testing everyone's password{' '}
            <strong>is their employee code</strong>. To get someone in, reset
            rather than look up:
          </p>
          <code className="mt-2 block rounded bg-ink-950 px-2.5 py-1.5 text-xs text-white">
            node scripts/user-admin.mjs reset E1234
          </code>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total accounts" value={data?.length ?? 0} />
        <StatTile
          label="On issued default"
          value={counts['Using the issued default'] ?? 0}
          sub="password is their ecode"
        />
        <StatTile
          label="Set their own"
          value={counts['Set their own password'] ?? 0}
        />
        <StatTile
          label="No login issued"
          value={counts['No login issued'] ?? 0}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="Search by code, name, email or manager"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
        >
          <option value="all">All login states</option>
          {Object.keys(STATE_STYLE).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Login</th>
                <th className="px-4 py-2.5">Manager</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5">Last sign-in</th>
                <th className="px-4 py-2.5">Password changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.slice(0, 200).map(r => (
                <tr key={r.employee_id} className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-900">
                      {r.full_name}
                      {!r.is_active && (
                        <span className="ml-2 badge bg-ink-100 text-ink-500">Inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-500">
                      {r.ecode}{r.designation && ` · ${r.designation}`}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-600">
                    {r.login_email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600">
                    {r.manager_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATE_STYLE[r.login_state] ?? 'bg-ink-100 text-ink-600'}`}>
                      {r.login_state}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmt(r.last_sign_in_at)}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmt(r.password_changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && (
          <p className="border-t border-ink-100 px-4 py-3 text-xs text-ink-500">
            Showing the first 200. Narrow the search, or export for the full list.
          </p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-400">
        <KeyRound className="h-3.5 w-3.5" />
        Resets are issued from the command line so the service-role key never
        reaches a browser.
      </p>
    </div>
  )
}
